"use client";

import Image from "next/image";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type User = {
  id: string;
  role: "student" | "teacher";
  username: string;
  displayName: string | null;
  classId: string | null;
  guardianConsentVerified: boolean;
  studentConsented: boolean;
  mustChangePassword: boolean;
};

type MoodOption = {
  id: string;
  label: string;
  cue: string;
  score: number;
  tone: string;
};

type MoodEntry = {
  id: string;
  mood: string;
  moodScore: number;
  note: string;
  goal: string;
  wantsSupport: boolean;
  safetyLevel: string;
  createdAt: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  provider?: string;
};

type RecordingState =
  | "idle"
  | "notice"
  | "requesting"
  | "recording"
  | "transcribing"
  | "review"
  | "error";

type CloudSpeechState = "idle" | "loading" | "playing" | "paused" | "error";

const moodOptions: MoodOption[] = [
  { id: "happy", label: "开心", cue: "明亮", score: 5, tone: "sun" },
  { id: "calm", label: "平静", cue: "安稳", score: 4, tone: "leaf" },
  { id: "tense", label: "紧张", cue: "绷紧", score: 3, tone: "sky" },
  { id: "sad", label: "难过", cue: "低落", score: 2, tone: "rain" },
  { id: "upset", label: "烦躁", cue: "发热", score: 1, tone: "coral" },
  { id: "unclear", label: "说不清", cue: "模糊", score: 0, tone: "mist" },
];

const moodFeedback: Record<string, string> = {
  happy: "开心也值得被认真记下。可以留住一件想记住的小事。",
  calm: "平静也值得被看见。可以写下让你安稳的一件事。",
  tense: "紧张常常说明有件事很在意。只写最卡住的一点就好。",
  sad: "难过时不用急着振作。写一句也可以，或直接找人聊聊。",
  upset: "先不用把事情全部说清楚。可以从最不舒服的一点开始。",
  unclear: "说不清也没关系。可以只写下身体现在的感觉。",
};

const quickPrompts = [
  "今天有件小事让我开心",
  "学习上有点卡住",
  "和同学相处有点难",
  "我想先安静一下",
];

const recordingMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
];

const providerNames: Record<string, string> = {
  deepseek: "DeepSeek",
  doubao: "豆包",
  kimi: "Kimi",
  qwen: "通义千问",
  "local-safety": "本地安全规则",
};

const crisisMessage =
  "如果你现在可能伤害自己或他人，请立刻离开危险物品和危险地点，去找身边可信任的成年人。紧急危险请拨打 110 或 120。";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("录音读取失败"));
    reader.onerror = () => reject(new Error("录音读取失败"));
    reader.readAsDataURL(blob);
  });
}

function makeLocalMessage(
  role: ChatMessage["role"],
  content: string,
  provider?: string,
): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    provider,
    createdAt: new Date().toISOString(),
  };
}

export default function StudentCompanion() {
  const [authState, setAuthState] = useState<"loading" | "ready" | "error">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [requiresConsent, setRequiresConsent] = useState(false);
  const [passwordGate, setPasswordGate] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [dataRightsBusy, setDataRightsBusy] = useState(false);
  const [dataRightsMessage, setDataRightsMessage] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawChecked, setWithdrawChecked] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");

  const [selectedMood, setSelectedMood] = useState<MoodOption | null>(null);
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState("");
  const [wantsSupport, setWantsSupport] = useState(false);
  const [wantsAi, setWantsAi] = useState(true);
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [phase, setPhase] = useState<"checkin" | "saved" | "chat">("checkin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [studentTurns, setStudentTurns] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [chatEnded, setChatEnded] = useState(false);
  const [provider, setProvider] = useState("");
  const [clock, setClock] = useState(0);
  const [chatStatus, setChatStatus] = useState("");

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [voiceTarget, setVoiceTarget] = useState<"note" | "chat">("note");

  const [cloudSpeechState, setCloudSpeechState] = useState<CloudSpeechState>("idle");
  const [cloudSpeechMessage, setCloudSpeechMessage] = useState("");
  const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null);
  const [deviceSpeechId, setDeviceSpeechId] = useState<string | null>(null);
  const [deviceSpeechSupported, setDeviceSpeechSupported] = useState<boolean | null>(null);

  const chatLogRef = useRef<HTMLDivElement>(null);
  const emergencyRef = useRef<HTMLElement>(null);
  const withdrawTitleRef = useRef<HTMLHeadingElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingLimitRef = useRef<number | null>(null);
  const stopReasonRef = useRef<"transcribe" | "cancel">("transcribe");
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const voiceRequestRef = useRef(0);
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloudAudioUrlRef = useRef<string | null>(null);
  const cloudSpeechAbortRef = useRef<AbortController | null>(null);
  const cloudSpeechRequestRef = useRef(0);

  const noteRemaining = 600 - note.length;
  const chatRemaining = 300 - chatDraft.length;
  const secondsRemaining = expiresAt
    ? clock === 0
      ? 15 * 60
      : Math.max(0, Math.ceil((new Date(expiresAt).getTime() - clock) / 1000))
    : 15 * 60;
  const turnsRemaining = Math.max(0, 12 - studentTurns);
  const conversationUnavailable = chatEnded || secondsRemaining <= 0 || turnsRemaining <= 0;

  const stopAudio = useCallback((message = "") => {
    cloudSpeechRequestRef.current += 1;
    cloudSpeechAbortRef.current?.abort();
    cloudSpeechAbortRef.current = null;
    const audio = cloudAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      cloudAudioRef.current = null;
    }
    if (cloudAudioUrlRef.current) {
      URL.revokeObjectURL(cloudAudioUrlRef.current);
      cloudAudioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setDeviceSpeechId(null);
    setActiveSpeechId(null);
    setCloudSpeechState("idle");
    setCloudSpeechMessage(message);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryBusy(true);
    try {
      const response = await fetch("/api/moods?limit=14", { cache: "no-store" });
      if (response.status === 401) {
        window.location.replace("/login?next=student");
        return;
      }
      const data = (await response.json()) as { entries?: MoodEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法读取记录");
      setEntries(data.entries || []);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "暂时无法读取记录");
    } finally {
      setHistoryBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await response.json()) as {
          authenticated?: boolean;
          user?: User;
          requiresStudentConsent?: boolean;
        };
        if (!active) return;
        if (!data.authenticated || !data.user) {
          window.location.replace("/login?next=student");
          return;
        }
        if (data.user.role === "teacher") {
          window.location.replace("/teacher");
          return;
        }
        setUser(data.user);
        setPasswordGate(Boolean(data.user.mustChangePassword));
        setRequiresConsent(
          !data.user.guardianConsentVerified || Boolean(data.requiresStudentConsent),
        );
        setAuthState("ready");
        if (!data.requiresStudentConsent && !data.user.mustChangePassword) void loadHistory();
      } catch {
        if (active) setAuthState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [loadHistory]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const canRecord =
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof window.MediaRecorder === "function" &&
        recordingMimeTypes.some((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      setVoiceSupported(canRecord);
      setDeviceSpeechSupported(
        "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!expiresAt || chatEnded) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, chatEnded]);

  useEffect(() => {
    if (phase !== "chat") return;
    const frame = window.requestAnimationFrame(() => {
      chatLogRef.current?.scrollTo({
        top: chatLogRef.current.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, chatBusy, phase]);

  useEffect(() => {
    if (!urgent) return;
    const frame = window.requestAnimationFrame(() => emergencyRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [urgent]);

  useEffect(() => {
    if (!withdrawOpen) return;
    const frame = window.requestAnimationFrame(() => withdrawTitleRef.current?.focus());
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !withdrawBusy) {
        setWithdrawOpen(false);
        setWithdrawChecked(false);
        setWithdrawError("");
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [withdrawOpen, withdrawBusy]);

  useEffect(() => () => {
    voiceRequestRef.current += 1;
    stopReasonRef.current = "cancel";
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    if (recordingLimitRef.current !== null) window.clearTimeout(recordingLimitRef.current);
    transcriptionAbortRef.current?.abort();
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    cloudSpeechRequestRef.current += 1;
    cloudSpeechAbortRef.current?.abort();
    cloudAudioRef.current?.pause();
    if (cloudAudioUrlRef.current) URL.revokeObjectURL(cloudAudioUrlRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  async function acceptConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.guardianConsentVerified || !consentChecked) return;
    setConsentBusy(true);
    setConsentError("");
    try {
      const response = await fetch("/api/auth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      const data = (await response.json()) as { user?: User; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法保存同意状态");
      setUser(data.user || { ...user, studentConsented: true });
      setRequiresConsent(false);
      void loadHistory();
    } catch (acceptError) {
      setConsentError(
        acceptError instanceof Error ? acceptError.message : "暂时无法保存同意状态",
      );
    } finally {
      setConsentBusy(false);
    }
  }

  async function changeInitialPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) {
      setPasswordError("新密码至少需要 12 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    setPasswordBusy(true);
    setPasswordError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await response.json()) as { user?: User; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法修改密码");
      setUser(data.user || (user ? { ...user, mustChangePassword: false } : user));
      setPasswordGate(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (!requiresConsent) void loadHistory();
    } catch (passwordChangeError) {
      setPasswordError(
        passwordChangeError instanceof Error ? passwordChangeError.message : "暂时无法修改密码",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  async function exportExistingData() {
    if (dataRightsBusy) return;
    setDataRightsBusy(true);
    setDataRightsMessage("");
    try {
      const [moodsResponse, chatsResponse] = await Promise.all([
        fetch("/api/moods?limit=100", { cache: "no-store" }),
        fetch("/api/chat/export", { cache: "no-store" }),
      ]);
      const moods = (await moodsResponse.json()) as { entries?: MoodEntry[]; error?: string };
      const chats = (await chatsResponse.json()) as { error?: string } & Record<string, unknown>;
      if (!moodsResponse.ok || !chatsResponse.ok) {
        throw new Error(moods.error || chats.error || "暂时无法导出已有数据");
      }
      const blob = new Blob([
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            schoolUsername: user?.username,
            moodEntries: moods.entries || [],
            chatArchive: chats,
          },
          null,
          2,
        ),
      ], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `xinban-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setDataRightsMessage("已生成本人数据文件。请将它保存在只有你能访问的位置。");
    } catch (exportError) {
      setDataRightsMessage(
        exportError instanceof Error ? exportError.message : "暂时无法导出已有数据",
      );
    } finally {
      setDataRightsBusy(false);
    }
  }

  async function deleteExistingData() {
    if (dataRightsBusy) return;
    const confirmed = window.confirm(
      "这会删除你的心情记录和 AI 对话原文，且无法恢复。为了学校安全处置留痕，不含原文的结构化安全事件可能按学校批准期限保留。确定继续吗？",
    );
    if (!confirmed) return;
    setDataRightsBusy(true);
    setDataRightsMessage("");
    try {
      const chatsResponse = await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const chats = (await chatsResponse.json()) as { error?: string };
      if (!chatsResponse.ok) throw new Error(chats.error || "暂时无法删除 AI 对话");

      const moodsResponse = await fetch("/api/moods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const moods = (await moodsResponse.json()) as { error?: string };
      if (!moodsResponse.ok) {
        throw new Error(
          moods.error || "AI 对话已删除，但心情记录暂时未能删除，请稍后再试",
        );
      }
      setEntries([]);
      setDataRightsMessage(
        "已删除你的心情记录和 AI 对话原文。不含原文的结构化安全事件可能按学校批准期限保留。",
      );
    } catch (deleteError) {
      setDataRightsMessage(
        deleteError instanceof Error ? deleteError.message : "暂时无法删除已有记录",
      );
    } finally {
      setDataRightsBusy(false);
    }
  }

  async function logout() {
    stopAudio();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.replace("/login");
  }

  function closeWithdrawDialog() {
    if (withdrawBusy) return;
    setWithdrawOpen(false);
    setWithdrawChecked(false);
    setWithdrawError("");
  }

  async function withdrawConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!withdrawChecked || withdrawBusy) return;
    setWithdrawBusy(true);
    setWithdrawError("");

    // Stop every user-initiated media path before consent is revoked. The
    // server clears the session cookie on success and rejects future writes.
    cancelRecording();
    stopAudio();
    setChatEnded(true);

    try {
      const response = await fetch("/api/auth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: false }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "暂时无法撤回同意，请稍后再试。 ");
      }
      window.location.replace("/login?consent=withdrawn");
    } catch (withdrawConsentError) {
      setWithdrawError(
        withdrawConsentError instanceof Error
          ? withdrawConsentError.message
          : "暂时无法撤回同意，请稍后再试。",
      );
      setWithdrawBusy(false);
    }
  }

  function resetCheckin() {
    stopAudio();
    setSelectedMood(null);
    setNote("");
    setGoal("");
    setWantsSupport(false);
    setWantsAi(true);
    setError("");
    setNotice("");
    setUrgent(false);
    setPhase("checkin");
    setConversationId(null);
    setMessages([]);
    setChatDraft("");
    setStudentTurns(0);
    setExpiresAt(null);
    setChatEnded(false);
    setChatStatus("");
  }

  async function saveCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMood) {
      setError("先选一个最接近此刻的心情。");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    stopAudio();
    try {
      const moodResponse = await fetch("/api/moods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood: selectedMood.id,
          moodScore: selectedMood.score,
          note: note.trim(),
          goal: goal.trim(),
          wantsSupport,
        }),
      });
      const moodData = (await moodResponse.json()) as {
        entry?: MoodEntry;
        urgent?: boolean;
        message?: string;
        error?: string;
      };
      if (moodResponse.status === 401) {
        window.location.replace("/login?next=student");
        return;
      }
      if (!moodResponse.ok) throw new Error(moodData.error || "这次记录没有保存成功");
      if (moodData.entry) setEntries((current) => [moodData.entry!, ...current]);

      if (moodData.urgent) {
        setUrgent(true);
        setChatStatus(moodData.message || crisisMessage);
        setPhase("saved");
        return;
      }

      if (!wantsAi) {
        setPhase("saved");
        setNotice(
          wantsSupport
            ? "心情已保存，也已记下你希望老师联系。"
            : "心情已保存。你可以随时退出，不需要继续对话。",
        );
        return;
      }

      const firstText = [
        note.trim() || `今天我感觉${selectedMood.label}。`,
        goal.trim() ? `我想做的小事：${goal.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const userMessage = makeLocalMessage("user", firstText);
      setMessages([userMessage]);
      setPhase("chat");
      setChatBusy(true);

      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: selectedMood.id, message: firstText }),
      });
      const chatData = (await chatResponse.json()) as {
        reply?: string;
        urgent?: boolean;
        provider?: string;
        conversationId?: string;
        studentTurns?: number;
        expiresAt?: string;
        ended?: boolean;
        error?: string;
      };
      if (!chatResponse.ok) {
        setPhase("saved");
        throw new Error(
          chatResponse.status === 503
            ? "心情已保存，但学校暂未配置 AI 对话。你仍可以找真人聊聊。"
            : chatData.error || "心情已保存，但 AI 对话暂时无法开始",
        );
      }
      const reply = chatData.reply || "谢谢你告诉我。我们可以一起想一个很小的下一步。";
      setProvider(chatData.provider || "");
      setConversationId(chatData.conversationId || null);
      setStudentTurns(chatData.studentTurns ?? 1);
      setExpiresAt(chatData.expiresAt || new Date(Date.now() + 15 * 60_000).toISOString());
      setClock(Date.now());
      setChatEnded(Boolean(chatData.ended));
      setMessages([userMessage, makeLocalMessage("assistant", reply, chatData.provider)]);
      if (chatData.urgent) {
        setUrgent(true);
        setChatStatus(reply || crisisMessage);
        setChatEnded(true);
      } else {
        setChatStatus("小伴已经回复。AI 生成内容可能有误，你可以采用、修改或忽略。 ");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暂时无法完成这次记录");
    } finally {
      setSubmitting(false);
      setChatBusy(false);
    }
  }

  async function sendChat(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = chatDraft.trim();
    if (!content || !conversationId || chatBusy || conversationUnavailable) return;
    stopAudio();
    const userMessage = makeLocalMessage("user", content);
    setMessages((current) => [...current, userMessage]);
    setChatDraft("");
    setChatBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood: selectedMood?.id || "unclear",
          message: content,
          conversationId,
        }),
      });
      const data = (await response.json()) as {
        reply?: string;
        urgent?: boolean;
        provider?: string;
        studentTurns?: number;
        expiresAt?: string;
        ended?: boolean;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 409) setChatEnded(true);
        throw new Error(data.error || "这句话没有发送成功，请稍后再试");
      }
      const reply = data.reply || "我听到了。要不要把现在最需要的一件事说得更具体一点？";
      setMessages((current) => [
        ...current,
        makeLocalMessage("assistant", reply, data.provider),
      ]);
      setProvider(data.provider || provider);
      setStudentTurns(data.studentTurns ?? studentTurns + 1);
      if (data.expiresAt) setExpiresAt(data.expiresAt);
      setClock(Date.now());
      if (data.ended) setChatEnded(true);
      setChatStatus(data.urgent ? reply : "小伴已经回复。AI 生成内容可能有误。");
      if (data.urgent) {
        setUrgent(true);
        setChatEnded(true);
      }
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "这句话没有发送成功");
    } finally {
      setChatBusy(false);
    }
  }

  function handleChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendChat();
    }
  }

  function finishConversation() {
    stopAudio();
    setChatEnded(true);
    setChatStatus("你已结束本次会话。内容仍保留在你的账号中，直到你主动删除。 ");
  }

  async function copyConversation() {
    const text = messages
      .map((message) => `${message.role === "assistant" ? "小伴（AI）" : "我"}：${message.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setChatStatus("会话已复制到剪贴板。请只分享给你信任的人。 ");
    } catch {
      setChatStatus("浏览器没有允许复制。你可以手动选择文字。 ");
    }
  }

  async function deleteConversation() {
    if (!conversationId || !window.confirm("删除后无法恢复这次 AI 会话。确定删除吗？")) return;
    stopAudio();
    setChatBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法删除会话");
      setConversationId(null);
      setMessages([]);
      setChatEnded(true);
      setPhase("saved");
      setNotice("这次 AI 会话已经删除。心情记录仍保留在你的账号中。 ");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "暂时无法删除会话");
    } finally {
      setChatBusy(false);
    }
  }

  function clearRecordingTimers() {
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    if (recordingLimitRef.current !== null) window.clearTimeout(recordingLimitRef.current);
    recordingTimerRef.current = null;
    recordingLimitRef.current = null;
  }

  function closeMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function transcribeRecording(blob: Blob, mimeType: string) {
    if (blob.size > 2_500_000) {
      setRecordingState("error");
      setVoiceMessage("录音文件超过 2.5MB，请缩短录音或改用文字输入。");
      return;
    }
    const requestId = ++voiceRequestRef.current;
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    setRecordingState("transcribing");
    setVoiceMessage("音频仅用于本次转写，不保存录音。");
    try {
      const dataUrl = await blobToDataUrl(blob);
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, mimeType }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        text?: string;
        urgent?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          response.status === 503
            ? "学校暂未配置语音转写，请改用文字输入。"
            : data.error || "语音转写没有完成",
        );
      }
      if (requestId !== voiceRequestRef.current) return;
      const text = data.text?.trim() || "";
      if (!text) throw new Error("没有识别到清晰文字，请改用文字输入。 ");
      if (voiceTarget === "chat") {
        setChatDraft((current) => `${current}${current.trim() ? " " : ""}${text}`.slice(0, 300));
      } else {
        setNote((current) => `${current}${current.trim() ? " " : ""}${text}`.slice(0, 600));
      }
      setRecordingState("review");
      setVoiceMessage("已转成文字，请检查并修改后再保存。录音已释放。 ");
      if (data.urgent) {
        setUrgent(true);
        setChatStatus(data.message || crisisMessage);
        if (voiceTarget === "chat") setChatEnded(true);
      }
    } catch (voiceError) {
      if (controller.signal.aborted) return;
      setRecordingState("error");
      setVoiceMessage(
        voiceError instanceof Error ? voiceError.message : "语音转写没有完成，请改用文字输入。",
      );
    } finally {
      if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
    }
  }

  async function startRecording() {
    if (!voiceSupported) {
      setRecordingState("error");
      setVoiceMessage("当前浏览器不支持安全录音格式，请改用文字输入。 ");
      return;
    }
    setRecordingState("requesting");
    setVoiceMessage("正在请求麦克风权限……");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = recordingMimeTypes.find((item) => MediaRecorder.isTypeSupported(item));
      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("当前浏览器不支持可用录音格式，请改用文字输入。 ");
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      stopReasonRef.current = "transcribe";
      recorder.ondataavailable = (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearRecordingTimers();
        closeMediaStream();
        const shouldTranscribe = stopReasonRef.current === "transcribe";
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        audioChunksRef.current = [];
        if (shouldTranscribe && blob.size) void transcribeRecording(blob, recorder.mimeType);
        else setRecordingState("idle");
      };
      recorder.start(250);
      setRecordingSeconds(0);
      setRecordingState("recording");
      setVoiceMessage("正在录音。说完后点“停止并转成文字”。 ");
      recordingTimerRef.current = window.setInterval(
        () => setRecordingSeconds((current) => Math.min(30, current + 1)),
        1000,
      );
      recordingLimitRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          stopReasonRef.current = "transcribe";
          recorder.stop();
        }
      }, 30_000);
    } catch (recordError) {
      closeMediaStream();
      setRecordingState("error");
      setVoiceMessage(
        recordError instanceof Error
          ? recordError.message
          : "没有获得麦克风权限，请改用文字输入。",
      );
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      stopReasonRef.current = "transcribe";
      mediaRecorderRef.current.stop();
    }
  }

  function cancelRecording() {
    voiceRequestRef.current += 1;
    transcriptionAbortRef.current?.abort();
    stopReasonRef.current = "cancel";
    clearRecordingTimers();
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    closeMediaStream();
    setRecordingState("idle");
    setVoiceMessage("");
  }

  async function speakWithCloud(message: ChatMessage) {
    if (urgent || message.role !== "assistant") return;
    const currentAudio = cloudAudioRef.current;
    if (activeSpeechId === message.id && currentAudio) {
      if (cloudSpeechState === "playing") {
        currentAudio.pause();
        setCloudSpeechState("paused");
      } else if (cloudSpeechState === "paused") {
        await currentAudio.play();
        setCloudSpeechState("playing");
      }
      return;
    }

    stopAudio();
    setActiveSpeechId(message.id);
    setCloudSpeechState("loading");
    setCloudSpeechMessage("正在生成 Qwen 语音……");
    const requestId = ++cloudSpeechRequestRef.current;
    const controller = new AbortController();
    cloudSpeechAbortRef.current = controller;
    try {
      const response = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.content, userInitiated: true }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          response.status === 503
            ? "云端朗读未配置，可使用设备朗读或直接阅读。"
            : data.error || "云端朗读暂时不可用",
        );
      }
      const blob = await response.blob();
      if (requestId !== cloudSpeechRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      cloudAudioUrlRef.current = url;
      const audio = new Audio(url);
      cloudAudioRef.current = audio;
      audio.onended = () => stopAudio("朗读已结束。 ");
      audio.onerror = () => {
        stopAudio();
        setCloudSpeechState("error");
        setCloudSpeechMessage("音频无法播放，可使用设备朗读或直接阅读。 ");
      };
      await audio.play();
      setCloudSpeechState("playing");
      setCloudSpeechMessage("正在使用 Qwen 语音朗读。 ");
    } catch (speechError) {
      if (controller.signal.aborted) return;
      stopAudio();
      setActiveSpeechId(message.id);
      setCloudSpeechState("error");
      setCloudSpeechMessage(
        speechError instanceof Error ? speechError.message : "云端朗读暂时不可用。",
      );
    }
  }

  function speakWithDevice(message: ChatMessage) {
    if (!deviceSpeechSupported || urgent) return;
    window.speechSynthesis.cancel();
    if (deviceSpeechId === message.id) {
      setDeviceSpeechId(null);
      return;
    }
    stopAudio();
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    utterance.onend = () => setDeviceSpeechId(null);
    utterance.onerror = () => setDeviceSpeechId(null);
    setDeviceSpeechId(message.id);
    window.speechSynthesis.speak(utterance);
  }

  const recentSummary = useMemo(() => {
    const supportCount = entries.filter((entry) => entry.wantsSupport).length;
    return { count: entries.length, supportCount };
  }, [entries]);

  if (authState === "loading") {
    return (
      <main className="app-loading" aria-busy="true">
        <Image src="/dog.svg" alt="" width={88} height={88} priority />
        <p>正在确认学校账号……</p>
      </main>
    );
  }

  if (authState === "error" || !user) {
    return (
      <main className="app-loading">
        <h1>暂时无法进入</h1>
        <p>没有连接到学校服务，请检查网络后重试。</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          重新尝试
        </button>
      </main>
    );
  }

  if (passwordGate) {
    return (
      <main className="consent-page">
        <section className="consent-card password-card" aria-labelledby="password-title">
          <div className="consent-brand">
            <Image src="/dog.svg" alt="" width={64} height={64} priority />
            <span>心伴 AI-Pet</span>
          </div>
          <p className="eyebrow">首次登录保护</p>
          <h1 id="password-title">先把学校发放的初始密码换掉</h1>
          <p className="consent-lead">新密码只用于你的学校账号。请不要使用姓名、生日、班级或常用社交账号密码。</p>
          <form className="password-form" onSubmit={changeInitialPassword}>
            <label htmlFor="current-password">学校发放的初始密码</label>
            <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            <label htmlFor="new-password">设置新密码</label>
            <input id="new-password" type="password" autoComplete="new-password" value={newPassword} minLength={12} onChange={(event) => setNewPassword(event.target.value)} required aria-describedby="new-password-help" />
            <p id="new-password-help" className="field-note">至少 12 个字符，建议使用几个无关词语加数字。</p>
            <label htmlFor="confirm-password">再次输入新密码</label>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required />
            {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
            <button className="primary-button" type="submit" disabled={passwordBusy}>{passwordBusy ? "正在修改……" : "保存新密码并继续"}</button>
            <button className="text-button" type="button" onClick={logout}>退出账号</button>
          </form>
        </section>
      </main>
    );
  }

  if (requiresConsent) {
    return (
      <main className="consent-page">
        <section className="consent-card" aria-labelledby="consent-title">
          <div className="consent-brand">
            <Image src="/dog.svg" alt="" width={64} height={64} priority />
            <span>心伴 AI-Pet</span>
          </div>
          <p className="eyebrow">首次使用说明</p>
          <h1 id="consent-title">在开始前，请先了解这些边界</h1>
          <p className="consent-lead">
            心伴用于记录每日心情，并在你主动选择时提供短时 AI 对话。它不是心理诊断，也不能代替老师、家长、医生或紧急服务。
          </p>
          <div className={`guardian-status ${user.guardianConsentVerified ? "is-verified" : "is-blocked"}`}>
            <strong>监护人同意：{user.guardianConsentVerified ? "学校已核验" : "学校尚未核验"}</strong>
            <p>
              {user.guardianConsentVerified
                ? "你可以阅读并确认自己的使用意愿。"
                : "在学校完成监护人同意核验前，你不能进入记录或 AI 对话。请联系老师。"}
            </p>
          </div>
          <ul className="consent-points">
            <li>心情记录会保存在学校部署的服务中；你可以查看和删除自己的内容。</li>
            <li>只有你主动选择 AI 对话时，相关文字才会发送给学校配置的模型。</li>
            <li>AI 可能出错；遇到安全问题应立即找真人，紧急危险拨打 110 或 120。</li>
            <li>老师只查看班级汇总、支持请求和最少必要安全线索，不查看普通聊天原文。</li>
          </ul>
          <form onSubmit={acceptConsent}>
            <label className="check-row consent-check">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)}
                disabled={!user.guardianConsentVerified}
              />
              <span>我读懂了这些边界，并愿意开始使用。</span>
            </label>
            {consentError && <p className="form-error" role="alert">{consentError}</p>}
            <div className="consent-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={!user.guardianConsentVerified || !consentChecked || consentBusy}
              >
                {consentBusy ? "正在保存……" : "同意并进入"}
              </button>
              <button className="text-button" type="button" onClick={logout}>退出账号</button>
            </div>
          </form>
          <section className="consent-data-rights" aria-labelledby="data-rights-title">
            <h2 id="data-rights-title">不同意 AI，也可以管理已有数据</h2>
            <p>
              你可以直接导出或删除本账号的心情和对话原文，无需重新同意记录、AI 或语音功能。
            </p>
            <div>
              <button type="button" className="quiet-button" onClick={exportExistingData} disabled={dataRightsBusy}>
                导出已有数据
              </button>
              <button type="button" className="data-delete-button" onClick={deleteExistingData} disabled={dataRightsBusy}>
                删除已有记录
              </button>
            </div>
            {dataRightsMessage && <p className="data-rights-status" role="status">{dataRightsMessage}</p>}
          </section>
        </section>
      </main>
    );
  }

  const today = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const displayName = user.displayName?.trim() || user.username;

  return (
    <div className="student-app" lang="zh-CN">
      <a className="skip-link" href="#student-main">跳到主要内容</a>
      <header className="student-topbar">
        <a className="student-brand" href="#student-main" aria-label="心伴 AI-Pet 首页">
          <Image src="/dog.svg" alt="" width={44} height={44} priority />
          <span><strong>心伴</strong><small>AI-Pet</small></span>
        </a>
        <nav className="student-nav" aria-label="学生页面导航">
          <a href="#today">今日记录</a>
          <button
            type="button"
            className="nav-button"
            onClick={() => {
              setHistoryOpen((open) => !open);
              if (!historyOpen) void loadHistory();
            }}
            aria-expanded={historyOpen}
          >
            我的记录
          </button>
          <a href="#human-help">找真人</a>
        </nav>
        <div className="student-account">
          <span><small>学校账号</small>{displayName}</span>
          <button type="button" onClick={logout}>退出</button>
        </div>
      </header>

      <main id="student-main" className="student-main">
        <section className="student-hero" aria-labelledby="student-title">
          <div>
            <p className="eyebrow">{today}</p>
            <h1 id="student-title">嗨，{displayName}。今天心里是什么天气？</h1>
            <p>不用写得完整，也没有标准答案。先照顾此刻真实的感受。</p>
          </div>
          <div className="privacy-pill"><span aria-hidden="true">●</span> 学校账号 · 隐私优先</div>
        </section>

        {urgent && (
          <section
            id="human-help"
            className="emergency-card"
            aria-labelledby="emergency-title"
            role="alert"
            tabIndex={-1}
            ref={emergencyRef}
          >
            <p className="eyebrow">现在先保证安全</p>
            <h2 id="emergency-title">请马上找一位身边的成年人</h2>
            <p>{chatStatus || crisisMessage}</p>
            <div className="emergency-actions">
              <a href="tel:110">拨打 110</a>
              <a href="tel:120">拨打 120</a>
              <span>也可以立刻去找老师、家长、校医或其他可信任的成年人</span>
            </div>
          </section>
        )}

        {phase === "checkin" && (
          <section id="today" className="checkin-workspace" aria-labelledby="checkin-title">
            <aside className={`pet-pane ${selectedMood ? `tone-${selectedMood.tone}` : ""}`}>
              <div className="pet-halo" aria-hidden="true"></div>
              <Image
                className="pet-image"
                src="/dog.svg"
                alt="小伴，一只陪你记录心情的小狗形象"
                width={260}
                height={260}
                priority
              />
              <div className="pet-dialogue" aria-live="polite">
                <strong>{selectedMood ? `我听见“${selectedMood.label}”了` : "我在这里，慢慢来"}</strong>
                <p>{selectedMood ? moodFeedback[selectedMood.id] : "先选一个最接近的感受。说不清也可以。"}</p>
              </div>
              <div className="pet-boundary">
                <span>小伴是 AI</span>
                <p>它不会生气、离开或评价你，也不能替代真人关系。</p>
              </div>
            </aside>

            <form className="checkin-card" onSubmit={saveCheckin}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">每日心情记录</p>
                  <h2 id="checkin-title">此刻最接近哪一种？</h2>
                </div>
                <span className="step-mark">约 1 分钟</span>
              </div>

              <fieldset className="mood-fieldset">
                <legend className="sr-only">选择此刻心情</legend>
                <div className="mood-grid">
                  {moodOptions.map((mood) => (
                    <button
                      key={mood.id}
                      type="button"
                      className={`mood-choice tone-${mood.tone} ${selectedMood?.id === mood.id ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedMood(mood);
                        setError("");
                      }}
                      aria-pressed={selectedMood?.id === mood.id}
                    >
                      <span className="mood-dot" aria-hidden="true"></span>
                      <strong>{mood.label}</strong>
                      <small>{mood.cue}</small>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="writing-block">
                <div className="writing-heading">
                  <label htmlFor="note">想说点什么？<small>可选</small></label>
                  <button
                    className="voice-trigger"
                    type="button"
                    onClick={() => {
                      setVoiceTarget("note");
                      setRecordingState((state) => state === "idle" ? "notice" : state);
                    }}
                    disabled={voiceSupported === false}
                    aria-expanded={recordingState !== "idle"}
                    aria-controls="voice-panel"
                  >
                    <span aria-hidden="true">◉</span> 语音输入
                  </button>
                </div>
                <div className="textarea-shell">
                  <textarea
                    id="note"
                    value={note}
                    maxLength={600}
                    rows={7}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="可以写发生了什么、身体有什么感觉，或者只写一句话……"
                    aria-describedby="note-privacy note-count"
                  />
                  <span id="note-count" className="char-count">{noteRemaining} 字可用</span>
                </div>
                <p id="note-privacy" className="privacy-note">这段文字会随心情记录保存。老师不会看到普通 AI 对话原文。</p>

                {recordingState !== "idle" && (
                  <div id="voice-panel" className={`voice-panel state-${recordingState}`} aria-live="polite">
                    {recordingState === "notice" && (
                      <>
                        <strong>录音前请确认</strong>
                        <p>最多录 30 秒、文件不超过 2.5MB（优先使用压缩录音格式）。音频只用于本次转写，不保存；转写文字可修改。</p>
                        <div className="inline-actions">
                          <button type="button" className="small-primary" onClick={startRecording}>允许并开始</button>
                          <button type="button" className="small-quiet" onClick={cancelRecording}>取消</button>
                        </div>
                      </>
                    )}
                    {recordingState === "requesting" && <p>正在请求麦克风权限……</p>}
                    {recordingState === "recording" && (
                      <>
                        <div className="recording-row"><span className="recording-dot" aria-hidden="true"></span><strong>正在录音</strong><time>0:{String(recordingSeconds).padStart(2, "0")} / 0:30</time></div>
                        <div className="inline-actions">
                          <button type="button" className="small-primary" onClick={stopRecording}>停止并转成文字</button>
                          <button type="button" className="small-quiet" onClick={cancelRecording}>取消录音</button>
                        </div>
                      </>
                    )}
                    {recordingState === "transcribing" && <p>正在转成文字。请不要关闭页面……</p>}
                    {(recordingState === "review" || recordingState === "error") && (
                      <>
                        <strong>{recordingState === "review" ? "请检查上面的文字" : "语音输入没有完成"}</strong>
                        <p>{voiceMessage}</p>
                        <button type="button" className="small-quiet" onClick={cancelRecording}>关闭</button>
                      </>
                    )}
                  </div>
                )}
                {voiceSupported === false && <p className="field-note">当前浏览器不支持安全录音格式，请使用文字输入。</p>}
              </div>

              <div className="prompt-chips" aria-label="快速填入一句开头">
                {quickPrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setNote((current) => current ? current : prompt)}>{prompt}</button>
                ))}
              </div>

              <label className="field-label" htmlFor="goal">今天想照顾好的一件小事 <small>可选</small></label>
              <input
                id="goal"
                className="text-input"
                value={goal}
                maxLength={120}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="例如：下课后去走一小圈"
              />

              <div className="choice-panel">
                <label className="check-row">
                  <input aria-label="我希望老师或辅导员联系我" type="checkbox" checked={wantsSupport} onChange={(event) => setWantsSupport(event.target.checked)} />
                  <span><strong>我希望老师或辅导员联系我</strong><small>这会进入真人支持队列，不等于评价或诊断。</small></span>
                </label>
                <label className="check-row">
                  <input aria-label="保存后进入一次短时 AI 对话" type="checkbox" checked={wantsAi} onChange={(event) => setWantsAi(event.target.checked)} />
                  <span><strong>保存后进入一次短时 AI 对话</strong><small>最多 15 分钟或 12 轮；内容可能发送给学校配置的 Qwen 北京模型。</small></span>
                </label>
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="save-button" type="submit" disabled={!selectedMood || submitting}>
                {submitting ? "正在保存……" : wantsAi ? "保存并进入 AI 对话" : "只保存心情"}
              </button>
              <p className="submit-boundary">先保存到学校服务；只有勾选 AI 对话才会调用模型。AI 不是心理诊断。</p>
            </form>
          </section>
        )}

        {phase === "chat" && (
          <section className="conversation-shell" aria-labelledby="conversation-title">
            <aside className="conversation-pet">
              <Image src="/dog.svg" alt="小伴 AI 小狗形象" width={218} height={218} />
              <p className="eyebrow">短时陪伴</p>
              <h2>一起把这一刻说清一点</h2>
              <p>小伴不会替你做决定。你随时可以结束、删除，或转向真人。</p>
              <a className="human-button" href="#human-support-card">找真人支持</a>
            </aside>
            <div className="conversation-card">
              <header className="conversation-header">
                <div>
                  <div className="ai-identity"><span aria-hidden="true">AI</span><strong id="conversation-title">小伴对话</strong></div>
                  <p>AI 生成 · 可能有误 · {providerNames[provider] || provider || "学校配置模型"}</p>
                </div>
                <div className="conversation-limits" aria-label="会话剩余限制">
                  <span><strong>{formatCountdown(secondsRemaining)}</strong> 剩余时间</span>
                  <span><strong>{turnsRemaining}</strong> 剩余轮次</span>
                </div>
              </header>

              <div className="conversation-toolbar" aria-label="会话操作">
                <button type="button" onClick={finishConversation} disabled={conversationUnavailable}>结束会话</button>
                <button type="button" onClick={copyConversation} disabled={!messages.length}>复制会话</button>
                <button type="button" className="danger-text" onClick={deleteConversation} disabled={!conversationId || chatBusy}>删除会话</button>
                <a href="#human-support-card">真人求助</a>
              </div>

              <div className="chat-log" ref={chatLogRef} aria-label="与小伴的对话">
                {messages.map((message) => (
                  <article key={message.id} className={`chat-message is-${message.role}`}>
                    <div className="chat-speaker">
                      {message.role === "assistant" ? (
                        <Image src="/dog.svg" alt="" width={36} height={36} />
                      ) : (
                        <span aria-hidden="true">我</span>
                      )}
                    </div>
                    <div className="chat-bubble">
                      <div className="chat-meta">
                        <strong>{message.role === "assistant" ? "小伴 · AI" : "我"}</strong>
                        <time>{formatDate(message.createdAt)}</time>
                      </div>
                      <p>{message.content}</p>
                      {message.role === "assistant" && !urgent && (
                        <div className="message-audio">
                          <button
                            type="button"
                            onClick={() => void speakWithCloud(message)}
                            disabled={cloudSpeechState === "loading" && activeSpeechId === message.id}
                            aria-pressed={activeSpeechId === message.id && cloudSpeechState === "playing"}
                          >
                            {activeSpeechId === message.id && cloudSpeechState === "loading"
                              ? "正在生成语音…"
                              : activeSpeechId === message.id && cloudSpeechState === "playing"
                                ? "暂停 Qwen 朗读"
                                : activeSpeechId === message.id && cloudSpeechState === "paused"
                                  ? "继续 Qwen 朗读"
                                  : "使用 Qwen 语音朗读"}
                          </button>
                          {activeSpeechId === message.id && (cloudSpeechState === "playing" || cloudSpeechState === "paused") && (
                            <button type="button" onClick={() => stopAudio("朗读已停止。 ")}>停止</button>
                          )}
                          {deviceSpeechSupported && (
                            <button type="button" onClick={() => speakWithDevice(message)} aria-pressed={deviceSpeechId === message.id}>
                              {deviceSpeechId === message.id ? "停止设备朗读" : "设备朗读"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {chatBusy && (
                  <div className="chat-thinking" role="status"><span></span><span></span><span></span> 小伴正在整理回应</div>
                )}
              </div>

              <div className="chat-live" aria-live="polite" aria-atomic="true">
                {conversationUnavailable && !chatEnded
                  ? turnsRemaining <= 0
                    ? "本次 12 轮对话已完成。可以休息一下，或找一位真人继续聊。"
                    : "本次 15 分钟对话已结束。可以休息一下，或找一位真人继续聊。"
                  : chatStatus}
                {cloudSpeechMessage ? ` ${cloudSpeechMessage}` : ""}
              </div>
              {error && <p className="form-error conversation-error" role="alert">{error}</p>}

              {conversationUnavailable ? (
                <div className="conversation-finished">
                  <strong>本次对话已收束</strong>
                  <p>{chatStatus || (turnsRemaining <= 0 ? "本次 12 轮已经完成。" : "本次 15 分钟已经结束。")}</p>
                  <button className="primary-button" type="button" onClick={resetCheckin}>开始新的心情记录</button>
                </div>
              ) : (
                <form className="chat-composer" onSubmit={(event) => void sendChat(event)}>
                  <div className="composer-heading">
                    <span>继续和小伴说</span>
                    <button
                      className="voice-trigger"
                      type="button"
                      onClick={() => {
                        setVoiceTarget("chat");
                        setRecordingState((state) => state === "idle" ? "notice" : state);
                      }}
                      disabled={voiceSupported === false || chatBusy}
                      aria-expanded={recordingState !== "idle" && voiceTarget === "chat"}
                    >
                      <span aria-hidden="true">◉</span> 语音输入
                    </button>
                  </div>
                  <label className="sr-only" htmlFor="chat-draft">继续和小伴说</label>
                  <textarea
                    id="chat-draft"
                    rows={3}
                    maxLength={300}
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder="继续说说看……按 Enter 发送，Shift + Enter 换行"
                    disabled={chatBusy}
                  />
                  <div className="composer-footer">
                    <span>{chatRemaining} 字可用</span>
                    <button type="submit" disabled={!chatDraft.trim() || chatBusy}>发送</button>
                  </div>
                  {voiceTarget === "chat" && recordingState !== "idle" && (
                    <div className={`voice-panel composer-voice state-${recordingState}`} aria-live="polite">
                      {recordingState === "notice" && (
                        <>
                          <strong>录音前请确认</strong>
                          <p>最多 30 秒且不超过 2.5MB。音频只用于转写、不保存；文字会先放进输入框，由你检查后再发送。</p>
                          <div className="inline-actions"><button type="button" className="small-primary" onClick={startRecording}>允许并开始</button><button type="button" className="small-quiet" onClick={cancelRecording}>取消</button></div>
                        </>
                      )}
                      {recordingState === "requesting" && <p>正在请求麦克风权限……</p>}
                      {recordingState === "recording" && (
                        <><div className="recording-row"><span className="recording-dot" aria-hidden="true"></span><strong>正在录音</strong><time>0:{String(recordingSeconds).padStart(2, "0")} / 0:30</time></div><div className="inline-actions"><button type="button" className="small-primary" onClick={stopRecording}>停止并转成文字</button><button type="button" className="small-quiet" onClick={cancelRecording}>取消</button></div></>
                      )}
                      {recordingState === "transcribing" && <p>正在转成文字，请稍候……</p>}
                      {(recordingState === "review" || recordingState === "error") && (
                        <><strong>{recordingState === "review" ? "已放入输入框，请检查" : "语音输入没有完成"}</strong><p>{voiceMessage}</p><button type="button" className="small-quiet" onClick={cancelRecording}>关闭</button></>
                      )}
                    </div>
                  )}
                </form>
              )}
            </div>
          </section>
        )}

        {phase === "saved" && !urgent && (
          <section className="saved-card" aria-labelledby="saved-title">
            <Image src="/dog.svg" alt="" width={112} height={112} />
            <div>
              <p className="eyebrow">已完成</p>
              <h2 id="saved-title">这次心情已经好好放下了</h2>
              <p>{notice || error || "不用继续解释。现在可以去做一件很小、很具体的事。"}</p>
              <div className="saved-actions">
                <button className="primary-button" type="button" onClick={resetCheckin}>记录新的心情</button>
                <button className="quiet-button" type="button" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>查看我的记录</button>
              </div>
            </div>
          </section>
        )}

        {historyOpen && (
          <section className="history-section" aria-labelledby="history-title">
            <div className="section-heading">
              <div><p className="eyebrow">只属于你的回看</p><h2 id="history-title">近期心情记录</h2></div>
              <button className="quiet-button" type="button" onClick={() => setHistoryOpen(false)}>收起</button>
            </div>
            {historyBusy ? (
              <p className="empty-state">正在读取……</p>
            ) : entries.length ? (
              <div className="history-list">
                {entries.map((entry) => (
                  <article key={entry.id}>
                    <span className={`history-dot tone-${moodOptions.find((mood) => mood.id === entry.mood)?.tone || "mist"}`}></span>
                    <div><strong>{moodOptions.find((mood) => mood.id === entry.mood)?.label || "已记录"}</strong><time>{formatDate(entry.createdAt)}</time></div>
                    <p>{entry.note || entry.goal || "这次只记录了心情。"}</p>
                    {entry.wantsSupport && <span className="support-tag">已请求真人支持</span>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">还没有记录。第一条可以只选一个心情，不必写文字。</p>
            )}
            <p className="history-summary">当前载入 {recentSummary.count} 条，其中 {recentSummary.supportCount} 条请求了真人支持。</p>
          </section>
        )}

        <section id="human-support-card" className="human-support-card" aria-labelledby="human-title">
          <div>
            <p className="eyebrow">真人永远在 AI 前面</p>
            <h2 id="human-title">不想和 AI 说，也完全可以</h2>
            <p>可以去找班主任、家长、校心理老师或其他信任的成年人。若有立即危险，请拨打 110 或 120。</p>
          </div>
          <div className="human-support-actions"><a href="tel:110">110</a><a href="tel:120">120</a></div>
        </section>
      </main>

      <a className="mobile-human-help" href="#human-support-card">找真人帮助</a>
      <footer className="student-footer">
        <div>
          <p>心伴 AI-Pet · 学校支持工具，不是诊断或评价系统</p>
          <p>AI 生成内容可能有误；安全问题请立即找真人。</p>
        </div>
        <button
          className="withdraw-consent-button"
          type="button"
          onClick={() => {
            setWithdrawOpen(true);
            setWithdrawChecked(false);
            setWithdrawError("");
          }}
        >
          撤回同意并退出
        </button>
      </footer>

      {withdrawOpen && (
        <div
          className="consent-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeWithdrawDialog();
          }}
        >
          <section
            className="consent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-consent-title"
            aria-describedby="withdraw-consent-description"
          >
            <p className="eyebrow">使用同意管理</p>
            <h2 id="withdraw-consent-title" ref={withdrawTitleRef} tabIndex={-1}>
              确认撤回同意并退出？
            </h2>
            <div id="withdraw-consent-description" className="withdraw-explanation">
              <p>确认后，你会立即退出，系统将停止新的心情记录、AI 对话、语音转写与云端朗读。</p>
              <p><strong>这不会自动删除已有内容。</strong>你以后仍可使用学校账号登录，并导出或删除自己的已有记录与会话。</p>
            </div>
            <div className="withdraw-warning">
              若只是想暂停，可以选择“暂不撤回”，直接退出账号即可。
            </div>
            <form onSubmit={withdrawConsent}>
              <label className="check-row withdraw-confirm-check">
                <input
                  type="checkbox"
                  checked={withdrawChecked}
                  onChange={(event) => setWithdrawChecked(event.target.checked)}
                  disabled={withdrawBusy}
                  aria-label="我理解撤回同意不会自动删除已有内容"
                />
                <span>
                  <strong>我理解撤回后会立即停止新使用并退出</strong>
                  <small>已有内容不会自动删除，需要由我之后登录并主动管理。</small>
                </span>
              </label>
              {withdrawError && <p className="form-error" role="alert">{withdrawError}</p>}
              <div className="withdraw-actions">
                <button type="button" className="quiet-button" onClick={closeWithdrawDialog} disabled={withdrawBusy}>
                  暂不撤回
                </button>
                <button type="submit" className="withdraw-danger-button" disabled={!withdrawChecked || withdrawBusy}>
                  {withdrawBusy ? "正在撤回并退出……" : "确认撤回同意并退出"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type CompanionState = "idle" | "mood-selected" | "saving" | "responding" | "done" | "urgent";
type RecordingState = "idle" | "notice" | "requesting" | "recording" | "transcribing" | "review" | "error";
type SpeechState = "idle" | "speaking" | "paused";
type CloudSpeechState = "idle" | "loading" | "playing" | "paused" | "error";

const moodOptions: MoodOption[] = [
  { id: "happy", label: "开心", cue: "明亮", score: 5, tone: "sun" },
  { id: "calm", label: "平静", cue: "安稳", score: 4, tone: "leaf" },
  { id: "tense", label: "紧张", cue: "绷紧", score: 3, tone: "sky" },
  { id: "sad", label: "难过", cue: "低落", score: 2, tone: "rain" },
  { id: "upset", label: "烦躁", cue: "发热", score: 1, tone: "coral" },
  { id: "unclear", label: "说不清", cue: "模糊", score: 0, tone: "mist" },
];

const quickPrompts = ["今天有件小事让我开心", "学习上有点卡住", "和同学相处有点难", "我想先安静一下"];
const recordingMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mpeg", "audio/wav"];

const moodFeedback: Record<string, string> = {
  happy: "记下开心也很重要。可以留下一件想记住的小事。",
  calm: "平静也值得被看见。可以写下让你安稳的一件事。",
  tense: "紧张常常说明有件事很在意。可以只写最卡住的一点。",
  sad: "难过时不用急着振作。写一句也可以，或直接找人聊聊。",
  upset: "先不用把事情全部说清楚。可以从最不舒服的一点开始。",
  unclear: "说不清也没关系。可以只停在这里，或写下身体现在的感觉。",
};

const providerNames: Record<string, string> = {
  deepseek: "DeepSeek",
  doubao: "豆包",
  kimi: "Kimi",
  qwen: "通义千问",
  demo: "安全示例回应",
};

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

function csvCell(value: string | number | boolean) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("录音读取失败"));
    reader.onerror = () => reject(new Error("录音读取失败"));
    reader.readAsDataURL(blob);
  });
}

export default function StudentCompanion() {
  const [participantCode, setParticipantCode] = useState("");
  const [selectedMood, setSelectedMood] = useState<MoodOption | null>(null);
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState("");
  const [wantsSupport, setWantsSupport] = useState(false);
  const [wantsAi, setWantsAi] = useState(false);
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [reply, setReply] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState<"save" | "ai" | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [companionState, setCompanionState] = useState<CompanionState>("idle");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [cloudSpeechState, setCloudSpeechState] = useState<CloudSpeechState>("idle");
  const [cloudSpeechMessage, setCloudSpeechMessage] = useState("");
  const replyRef = useRef<HTMLElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingLimitRef = useRef<number | null>(null);
  const stopReasonRef = useRef<"transcribe" | "cancel">("transcribe");
  const voiceRequestRef = useRef(0);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloudAudioUrlRef = useRef<string | null>(null);
  const cloudSpeechAbortRef = useRef<AbortController | null>(null);
  const cloudSpeechRequestRef = useRef(0);

  const validCode = /^[A-Za-z0-9_-]{4,20}$/.test(participantCode.trim());
  const remaining = 600 - note.length;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const canRecord = typeof navigator.mediaDevices?.getUserMedia === "function"
        && typeof window.MediaRecorder === "function"
        && recordingMimeTypes.some((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      setVoiceSupported(canRecord);
      setSpeechSupported(typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance === "function");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!reply && !urgent) return;
    const frame = window.requestAnimationFrame(() => {
      if (urgent) {
        replyRef.current?.focus();
        return;
      }
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      replyRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reply, urgent]);

  const stopCloudSpeech = useCallback((nextMessage = "") => {
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
    setCloudSpeechState("idle");
    setCloudSpeechMessage(nextMessage);
  }, []);

  const clearCloudSpeechResources = useCallback(() => {
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
  }, []);

  useEffect(() => () => {
    voiceRequestRef.current += 1;
    stopReasonRef.current = "cancel";
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    if (recordingLimitRef.current !== null) window.clearTimeout(recordingLimitRef.current);
    transcriptionAbortRef.current?.abort();
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    window.speechSynthesis?.cancel();
    cloudSpeechRequestRef.current += 1;
    cloudSpeechAbortRef.current?.abort();
    cloudAudioRef.current?.pause();
    cloudAudioRef.current?.removeAttribute("src");
    if (cloudAudioUrlRef.current) URL.revokeObjectURL(cloudAudioUrlRef.current);
  }, []);

  const loadHistory = useCallback(async (code = participantCode.trim()) => {
    if (!/^[A-Za-z0-9_-]{4,20}$/.test(code)) {
      setError("请输入学校发放的 4–20 位匿名编号（字母、数字、- 或 _）。");
      return;
    }

    setLoadingHistory(true);
    setError("");
    try {
      const response = await fetch(`/api/moods?participantCode=${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { entries?: MoodEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法读取记录");
      setEntries(data.entries || []);
      setHistoryOpen(true);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "暂时无法读取记录");
    } finally {
      setLoadingHistory(false);
    }
  }, [participantCode]);

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const withAi = wantsAi;
    let recordSaved = false;
    clearCloudSpeechResources();
    setCloudSpeechState("idle");
    setCloudSpeechMessage("");
    setError("");
    setNotice("");
    setReply("");
    setProvider("");
    setUrgent(false);
    window.speechSynthesis?.cancel();
    setSpeechState("idle");

    const code = participantCode.trim();
    if (!validCode) {
      setError("请先输入学校发放的 4–20 位匿名编号。");
      return;
    }
    if (!selectedMood) {
      setError("请选一个最接近的心情，也可以选择“说不清”。");
      return;
    }

    setSubmitting(withAi ? "ai" : "save");
    setCompanionState("saving");
    try {
      const moodResponse = await fetch("/api/moods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantCode: code,
          mood: selectedMood.label,
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
      if (!moodResponse.ok) throw new Error(moodData.error || "记录没有保存成功，请重试");

      recordSaved = true;
      setNotice(withAi ? "今天的记录已保存，正在准备一条可选的 AI 建议。" : "今天的记录已保存。你可以随时查看、导出或删除它。");
      if (moodData.entry) setEntries((current) => [moodData.entry!, ...current.filter((item) => item.id !== moodData.entry!.id)]);

      if (moodData.urgent) {
        setUrgent(true);
        setReply(moodData.message || "请现在联系身边可信任的成年人。");
        setCompanionState("urgent");
      } else if (withAi) {
        setCompanionState("responding");
        const chatMessage = note.trim() || `我今天的心情是${selectedMood.label}。`;
        const chatResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participantCode: code, mood: selectedMood.label, message: chatMessage }),
        });
        const chatData = (await chatResponse.json()) as {
          reply?: string;
          urgent?: boolean;
          provider?: string;
          error?: string;
        };
        if (!chatResponse.ok) throw new Error(chatData.error || "AI 回应暂时不可用，但你的记录已经保存");
        setReply(chatData.reply || "谢谢你记录此刻的感受。现在可以先选一个很小、很容易完成的下一步。");
        setProvider(chatData.provider || "demo");
        setUrgent(Boolean(chatData.urgent));
        setCompanionState(chatData.urgent ? "urgent" : "done");
        setNotice("记录已保存。下面是一条可选的 AI 建议，你可以按自己的情况决定是否采用。");
      } else {
        setCompanionState("done");
      }

      setNote("");
      setGoal("");
      setWantsSupport(false);
      setWantsAi(false);
    } catch (submitError) {
      if (recordSaved) {
        setError("记录已经保存，但 AI 回应暂时不可用。你仍然可以查看记录或找现实中的人聊聊。");
        setCompanionState("done");
      } else {
        setError(submitError instanceof Error ? submitError.message : "暂时无法提交，请稍后重试");
        setCompanionState(selectedMood ? "mood-selected" : "idle");
      }
    } finally {
      setSubmitting(null);
    }
  }

  function chooseMood(mood: MoodOption) {
    setSelectedMood(mood);
    setCompanionState("mood-selected");
    setError("");
    setNotice("");
  }

  function appendPrompt(prompt: string) {
    setNote((current) => current.trim() ? `${current.trimEnd()}\n${prompt}`.slice(0, 600) : prompt);
    if (selectedMood) setCompanionState("mood-selected");
  }

  function clearRecordingTimers() {
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    if (recordingLimitRef.current !== null) window.clearTimeout(recordingLimitRef.current);
    recordingTimerRef.current = null;
    recordingLimitRef.current = null;
  }

  function releaseMicrophone() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function transcribeRecording(blob: Blob, mimeType: string) {
    if (!blob.size) {
      setRecordingState("error");
      setVoiceMessage("没有收到可转写的声音。音频未保存，请重试或改用文字输入。");
      return;
    }
    if (blob.size > 2_500_000) {
      audioChunksRef.current = [];
      setRecordingState("error");
      setVoiceMessage("录音文件超过 2.5 MB，未上传也未保存。请缩短录音或改用文字输入。");
      return;
    }

    setRecordingState("transcribing");
    setVoiceMessage("正在转成文字；完成前不会保存这段音频。");
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;

    try {
      const dataUrl = await blobToDataUrl(blob);
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, mimeType }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        text?: string;
        transcript?: string;
        urgent?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 503) {
          throw new Error("语音转写服务暂未配置。音频没有保存，请继续使用文字输入。");
        }
        throw new Error(data.error || "语音暂时无法转成文字。音频没有保存。");
      }

      const transcript = (data.text || data.transcript || "").trim();
      if (!transcript) throw new Error("没有识别到清楚的文字。音频没有保存，可以重试或直接输入。");
      setNote((current) => [current.trim(), transcript].filter(Boolean).join("\n").slice(0, 600));
      setRecordingState("review");
      if (data.urgent) {
        clearCloudSpeechResources();
        setCloudSpeechState("idle");
        setCloudSpeechMessage("");
        stopSpeech();
        setUrgent(true);
        setProvider("");
        setReply(data.message || "请现在联系身边可信任的成年人。若你或别人正面临立即危险，请拨打 110 或 120。");
        setCompanionState("urgent");
        setVoiceMessage("已转成可编辑文字，音频已丢弃。内容中出现了需要立刻让真人确认的安全信号；文字尚未自动保存，请现在先联系身边可信任的大人。");
      } else {
        setVoiceMessage("已转成可编辑文字，音频已丢弃。请检查内容，再决定是否保存。");
        if (selectedMood) setCompanionState("mood-selected");
      }
    } catch (voiceError) {
      if (voiceError instanceof DOMException && voiceError.name === "AbortError") return;
      setRecordingState("error");
      setVoiceMessage(voiceError instanceof Error ? voiceError.message : "语音转写失败。音频没有保存，请改用文字输入。");
    } finally {
      audioChunksRef.current = [];
      if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
    }
  }

  async function startVoiceRecording() {
    setVoiceMessage("");
    if (!voiceSupported || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingState("error");
      setVoiceMessage("此设备暂不支持安全录音，请继续使用文字输入。");
      return;
    }

    const requestId = ++voiceRequestRef.current;
    setRecordingState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestId !== voiceRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const mimeType = recordingMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        releaseMicrophone();
        setRecordingState("error");
        setVoiceMessage("此浏览器不能生成学校转写服务支持的录音格式。音频未保存，请继续使用文字输入。");
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      stopReasonRef.current = "transcribe";

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      });
      recorder.addEventListener("error", () => {
        clearRecordingTimers();
        releaseMicrophone();
        audioChunksRef.current = [];
        setRecordingState("error");
        setVoiceMessage("录音出现问题，音频没有保存。请重试或改用文字输入。");
      });
      recorder.addEventListener("stop", () => {
        clearRecordingTimers();
        releaseMicrophone();
        mediaRecorderRef.current = null;
        const chunks = audioChunksRef.current;
        const resolvedMime = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, { type: resolvedMime });
        if (stopReasonRef.current === "cancel") {
          audioChunksRef.current = [];
          setRecordingState("idle");
          setVoiceMessage("已取消录音，音频没有保存。");
          return;
        }
        void transcribeRecording(blob, resolvedMime);
      });

      recorder.start(250);
      setRecordingSeconds(0);
      setRecordingState("recording");
      setVoiceMessage("正在录音，最多 30 秒。可以随时停止或取消。");
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => Math.min(current + 1, 30));
      }, 1000);
      recordingLimitRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          stopReasonRef.current = "transcribe";
          recorder.stop();
        }
      }, 30_000);
    } catch (permissionError) {
      if (requestId !== voiceRequestRef.current) return;
      clearRecordingTimers();
      releaseMicrophone();
      setRecordingState("error");
      setVoiceMessage(permissionError instanceof DOMException && permissionError.name === "NotAllowedError"
        ? "没有获得麦克风权限。你可以继续打字，或在浏览器设置中稍后开启。"
        : "暂时无法启动麦克风，请继续使用文字输入。");
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      stopReasonRef.current = "transcribe";
      mediaRecorderRef.current.stop();
    }
  }

  function cancelVoiceRecording() {
    voiceRequestRef.current += 1;
    stopReasonRef.current = "cancel";
    transcriptionAbortRef.current?.abort();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }
    clearRecordingTimers();
    releaseMicrophone();
    audioChunksRef.current = [];
    setRecordingState("idle");
    setVoiceMessage("已取消，音频没有保存。");
  }

  async function toggleCloudSpeech() {
    if (!reply || urgent) return;

    if (cloudSpeechState === "playing") {
      cloudAudioRef.current?.pause();
      setCloudSpeechState("paused");
      setCloudSpeechMessage("Qwen 云端朗读已暂停。");
      return;
    }
    if (cloudSpeechState === "paused" && cloudAudioRef.current) {
      try {
        await cloudAudioRef.current.play();
        setCloudSpeechState("playing");
        setCloudSpeechMessage("正在使用 Qwen 语音朗读。音频仅用于本次播放。");
      } catch {
        stopCloudSpeech("暂时无法继续播放。可以使用设备朗读或直接阅读文字。");
        setCloudSpeechState("error");
      }
      return;
    }

    stopCloudSpeech();
    stopSpeech();
    const requestId = cloudSpeechRequestRef.current;
    const controller = new AbortController();
    cloudSpeechAbortRef.current = controller;
    setCloudSpeechState("loading");
    setCloudSpeechMessage("正在准备 Qwen 云端语音…");

    try {
      const response = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: reply, userInitiated: true }),
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        let serverMessage = "";
        try {
          const data = (await response.json()) as { error?: string };
          serverMessage = data.error || "";
        } catch {
          serverMessage = "";
        }
        if (response.status === 503) {
          throw new Error("云端朗读未配置，可使用设备朗读/直接阅读");
        }
        throw new Error(serverMessage || "云端朗读暂时不可用，可使用设备朗读或直接阅读文字。");
      }

      const audioBlob = await response.blob();
      if (requestId !== cloudSpeechRequestRef.current || controller.signal.aborted) return;
      if (!audioBlob.size) throw new Error("云端朗读没有返回音频，可使用设备朗读或直接阅读文字。");

      const audioUrl = URL.createObjectURL(audioBlob);
      cloudAudioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      cloudAudioRef.current = audio;
      audio.onended = () => stopCloudSpeech("Qwen 云端朗读已完成。");
      audio.onerror = () => {
        stopCloudSpeech("云端音频无法播放，可使用设备朗读或直接阅读文字。");
        setCloudSpeechState("error");
      };
      await audio.play();
      if (requestId !== cloudSpeechRequestRef.current) return;
      setCloudSpeechState("playing");
      setCloudSpeechMessage("正在使用 Qwen 语音朗读。音频仅用于本次播放。");
    } catch (cloudSpeechError) {
      if (cloudSpeechError instanceof DOMException && cloudSpeechError.name === "AbortError") return;
      const message = cloudSpeechError instanceof Error
        ? cloudSpeechError.message
        : "云端朗读暂时不可用，可使用设备朗读或直接阅读文字。";
      stopCloudSpeech(message);
      setCloudSpeechState("error");
    } finally {
      if (requestId === cloudSpeechRequestRef.current) cloudSpeechAbortRef.current = null;
    }
  }

  function toggleSpeech() {
    if (!speechSupported || !reply || urgent) return;
    if (speechState === "speaking") {
      window.speechSynthesis.pause();
      setSpeechState("paused");
      return;
    }
    if (speechState === "paused") {
      window.speechSynthesis.resume();
      setSpeechState("speaking");
      return;
    }

    window.speechSynthesis.cancel();
    stopCloudSpeech();
    const utterance = new SpeechSynthesisUtterance(reply);
    const chineseVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("zh"));
    if (chineseVoice) utterance.voice = chineseVoice;
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => setSpeechState("idle");
    utterance.onerror = () => setSpeechState("idle");
    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setSpeechState("speaking");
  }

  function stopSpeech() {
    window.speechSynthesis?.cancel();
    speechUtteranceRef.current = null;
    setSpeechState("idle");
  }

  function finishSession() {
    stopCloudSpeech();
    stopSpeech();
    setReply("");
    setProvider("");
    setNotice("今天先记到这里就好。记录已经保存，你不必马上解决全部。");
    setCompanionState("done");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("today")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  async function deleteMyRecords() {
    const code = participantCode.trim();
    if (!validCode) {
      setError("请先输入你的匿名编号。");
      return;
    }
    if (!window.confirm("确定删除这个匿名编号下的全部心情记录吗？删除后无法恢复。")) return;

    setError("");
    try {
      const response = await fetch("/api/moods", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantCode: code }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法删除记录");
      setEntries([]);
      setNotice("这个匿名编号下的记录已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "暂时无法删除记录");
    }
  }

  function downloadMyRecords() {
    if (!entries.length) {
      setError("当前没有可导出的记录。");
      return;
    }
    const rows = [
      ["时间", "心情", "小目标", "主动请求真人支持"],
      ...entries.map((entry) => [formatDate(entry.createdAt), entry.mood, entry.goal, entry.wantsSupport ? "是" : "否"]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `xinban-${participantCode.trim()}-records.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const weekSummary = useMemo(() => {
    const recent = entries.slice(0, 7);
    const days = new Set(recent.map((entry) => new Date(entry.createdAt).toLocaleDateString("zh-CN"))).size;
    return { recent, days };
  }, [entries]);

  const companionStatus: Record<CompanionState, string> = {
    idle: "AI 回应可选",
    "mood-selected": "已记下这份心情",
    saving: "正在安全保存",
    responding: "正在整理文字",
    done: "今天的记录已完成",
    urgent: "现在先联系真人",
  };
  const voiceBusy = recordingState === "requesting" || recordingState === "recording" || recordingState === "transcribing";
  const recordingTime = `0:${String(recordingSeconds).padStart(2, "0")} / 0:30`;
  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);
  const shanghaiHour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).format(now));
  const greeting = shanghaiHour < 11 ? "上午好" : shanghaiHour < 14 ? "中午好" : shanghaiHour < 18 ? "下午好" : "晚上好";

  return (
    <div className="site-shell" data-state={companionState} data-mood={selectedMood?.tone || "none"}>
      <a className="skip-link" href="#today">跳到今天的心情记录</a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="心伴 AI-Pet 首页">
          <span className="brand-image" aria-hidden="true">
            <Image src="/dog.svg" alt="" width={42} height={42} priority />
          </span>
          <span>
            <strong>心伴</strong>
            <small>AI-PET · v4.0</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <a className="nav-today" href="#today" aria-current="page">今天</a>
          <button type="button" className="nav-button nav-records" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>我的记录</button>
          <a className="nav-help" href="#help">找真人</a>
          <Link className="nav-teacher" href="/teacher">教师端</Link>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow">{todayLabel} · 今天也照顾自己</div>
            <h1 id="hero-title">{greeting}，同学</h1>
            <p>今天的开心、困惑和小进步，都可以放在这里。只选一个心情，也算认真照顾了自己。</p>
          </div>
          <div className="identity-card" aria-labelledby="identity-title">
            <div>
              <span className="step-dot" aria-hidden="true">01</span>
              <div>
                <strong id="identity-title">我的匿名空间</strong>
                <small>使用学校发放的编号，不写姓名</small>
              </div>
            </div>
            <label className="code-field" htmlFor="participant-code">
              <span className="sr-only">学校发放的匿名编号</span>
              <input
                id="participant-code"
                value={participantCode}
                onChange={(event) => setParticipantCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20))}
                placeholder="例如 XB-042"
                autoComplete="off"
                inputMode="text"
                aria-invalid={participantCode.length > 0 && !validCode}
                aria-describedby="participant-code-help"
              />
              <button type="button" onClick={() => void loadHistory()} disabled={loadingHistory || !participantCode}>
                {loadingHistory ? "读取中…" : "查看记录"}
              </button>
            </label>
            <p id="participant-code-help"><strong>隐私说明：</strong>编号由学校单独发放，真实姓名不会发送给模型。</p>
          </div>
        </section>

        <section id="today" className="workspace" aria-labelledby="today-title">
          <aside className="companion-card">
            <div className="companion-head">
              <div className="online-pill" role="status" aria-live="polite"><span></span> {companionStatus[companionState]}</div>
              <span className="companion-mode">需你主动开启</span>
            </div>
            <div className="pet-stage">
              <Image key={selectedMood?.id || "idle"} src="/dog.svg" alt="AI 心情伙伴小伴" className="pet-image" width={260} height={260} priority />
            </div>
            <div className="pet-speech">
              <h2>我是 AI 小伴</h2>
              <p>{selectedMood ? moodFeedback[selectedMood.id] : "慢慢来。你可以先选一个最接近的心情，再决定要不要写几句。"}</p>
              <small>我不是真人，也可能理解错；你随时可以跳过或找现实中的人。</small>
            </div>
            <div className="pet-boundary">
              <strong>这段陪伴会在今天收束</strong>
              <span>记录心情 · 可选一次 AI 建议 · 需要时找真人</span>
            </div>
            <div className="reality-note">不是诊断、测评或紧急服务</div>
          </aside>

          <form className="checkin-card" onSubmit={(event) => void submitEntry(event)} aria-busy={Boolean(submitting)}>
            <div className="card-heading">
              <div>
                <span className="step-label">TODAY&apos;S CHECK-IN</span>
                <h2 id="today-title">把此刻轻轻记下来</h2>
                <p>先选心情，再决定是否补充文字。没有标准答案。</p>
              </div>
              <span className="optional-badge">约 30 秒</span>
            </div>

            <div className="mood-grid" role="radiogroup" aria-label="选择今天的心情" aria-describedby={selectedMood ? "mood-feedback" : undefined}>
              {moodOptions.map((mood, index) => (
                <label
                  key={mood.id}
                  className={`mood-option mood-${mood.tone}${selectedMood?.id === mood.id ? " selected" : ""}`}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="mood"
                    value={mood.id}
                    checked={selectedMood?.id === mood.id}
                    onChange={() => chooseMood(mood)}
                  />
                  <span className="mood-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{mood.label}</strong>
                  <small>{mood.cue}</small>
                </label>
              ))}
            </div>

            {selectedMood && (
              <p key={selectedMood.id} id="mood-feedback" className="mood-feedback" role="status" aria-live="polite">
                <strong>{selectedMood.label}</strong>
                <span>{moodFeedback[selectedMood.id]}</span>
              </p>
            )}

            <div className="prompt-row" aria-label="可以点选一个开头">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => appendPrompt(prompt)}>{prompt}</button>
              ))}
            </div>

            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="daily-note">今天最想记下什么？ <small>可不填</small></label>
                <button
                  className="voice-trigger"
                  type="button"
                  disabled={voiceSupported !== true || voiceBusy || Boolean(submitting)}
                  aria-expanded={recordingState !== "idle"}
                  aria-controls="voice-panel"
                  onClick={() => {
                    setVoiceMessage("");
                    setRecordingState("notice");
                  }}
                >
                  {voiceSupported === null ? "正在检查语音…" : voiceSupported ? "使用语音输入" : "设备不支持录音"}
                </button>
              </div>
              <textarea
                id="daily-note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value.slice(0, 600));
                  if (selectedMood) setCompanionState("mood-selected");
                }}
                placeholder="比如：数学最后一道题有点难，我有些着急……"
                rows={4}
                aria-describedby={(recordingState !== "idle" || voiceMessage || voiceSupported === false) ? "note-help voice-status" : "note-help"}
              />
              <small id="note-help" className={remaining < 60 ? "count warning" : "count"}>请不要写姓名、电话或住址 · 还可写 {remaining} 字</small>

              {(recordingState !== "idle" || voiceMessage || voiceSupported === false) && (
                <div id="voice-panel" className={`voice-panel state-${recordingState}`}>
                  {recordingState === "notice" && (
                    <div className="voice-disclosure" role="note">
                      <strong>开始前请确认</strong>
                      <p>最多录 30 秒、文件不超过 2.5MB（优先使用压缩录音格式）。确认后才会把音频发送给学校配置的阿里云百炼北京语音转写服务；转成文字后立即丢弃音频。请先检查文字，再决定是否保存。</p>
                      <div className="voice-actions">
                        <button type="button" className="voice-primary" onClick={() => void startVoiceRecording()}>我知道了，开始录音</button>
                        <button type="button" onClick={cancelVoiceRecording}>暂不使用</button>
                      </div>
                    </div>
                  )}

                  {recordingState === "requesting" && (
                    <div className="voice-progress" role="status">
                      <span className="recording-dot" aria-hidden="true"></span>
                      <strong>正在请求麦克风权限…</strong>
                      <button type="button" onClick={cancelVoiceRecording}>取消</button>
                    </div>
                  )}

                  {recordingState === "recording" && (
                    <div className="voice-progress recording" role="status" aria-live="polite">
                      <span className="recording-dot" aria-hidden="true"></span>
                      <strong>正在录音</strong>
                      <time>{recordingTime}</time>
                      <div className="voice-actions">
                        <button type="button" className="voice-primary" onClick={stopVoiceRecording}>停止并转成文字</button>
                        <button type="button" onClick={cancelVoiceRecording}>取消并删除</button>
                      </div>
                    </div>
                  )}

                  {recordingState === "transcribing" && (
                    <div className="voice-progress" role="status" aria-live="polite">
                      <span className="recording-dot" aria-hidden="true"></span>
                      <strong>正在转成文字…</strong>
                      <button type="button" onClick={cancelVoiceRecording}>取消</button>
                    </div>
                  )}

                  {(recordingState === "review" || recordingState === "error") && (
                    <div className="voice-result" role={recordingState === "error" ? "alert" : "status"}>
                      <strong>{recordingState === "review" ? "请检查上面的文字" : "语音输入没有完成"}</strong>
                      <div className="voice-actions">
                        <button type="button" onClick={() => { setVoiceMessage(""); setRecordingState("notice"); }}>再次语音输入</button>
                        <button type="button" onClick={() => { setRecordingState("idle"); setVoiceMessage(""); }}>关闭提示</button>
                      </div>
                    </div>
                  )}

                  <p id="voice-status" className="voice-message" role="status" aria-live="polite">
                    {voiceSupported === false ? "此设备暂不支持安全录音，请继续使用文字输入。" : voiceMessage}
                  </p>
                </div>
              )}
            </div>

            <label className="field-group goal-field">
              <span>给今天一个小小的下一步 <small>可不填</small></span>
              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value.slice(0, 80))}
                placeholder="比如：把错题整理一题"
              />
            </label>

            <label className="support-toggle" htmlFor="wants-support" aria-label="我想找老师或支持人员聊聊">
              <input id="wants-support" type="checkbox" checked={wantsSupport} aria-describedby="support-share-help" onChange={(event) => setWantsSupport(event.target.checked)} />
              <span className="toggle-box" aria-hidden="true"></span>
              <span>
                <strong>我想找老师或支持人员聊聊</strong>
                <small id="support-share-help">只有你主动请求或出现明确安全风险时，才会共享最少必要信息。</small>
              </span>
            </label>

            <label className="support-toggle ai-choice" htmlFor="wants-ai" aria-label="我也想要一条可选的 AI 建议">
              <input id="wants-ai" type="checkbox" checked={wantsAi} aria-describedby="ai-share-help" onChange={(event) => setWantsAi(event.target.checked)} />
              <span className="toggle-box" aria-hidden="true"></span>
              <span>
                <strong>我也想要一条可选的 AI 建议</strong>
                <small id="ai-share-help">默认关闭。开启后，本次记录文字会临时发送给学校配置的模型；AI 回复不保存。</small>
              </span>
            </label>

            {(error || notice) && (
              <div id="form-message" className={error ? "form-message error" : "form-message success"} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
                {error || notice}
              </div>
            )}

            <div className="form-actions">
              <button className="primary-action save-action" type="submit" disabled={Boolean(submitting) || voiceBusy}>
                {submitting ? (companionState === "responding" ? "正在整理你写的内容…" : "正在安全保存…") : (wantsAi ? "保存记录并获取 AI 建议" : "保存今天的记录")}
              </button>
            </div>
            <p className="consent-copy">记录框文字会随本次心情记录保存。{wantsAi ? "本次还会临时发送给学校配置的模型，AI 回复不保存。" : "目前不会发送给模型。"}</p>
          </form>

          <aside className="side-stack">
            <section className="insight-card">
              <span className="step-label">RECENT CHECK-INS</span>
              <h2>最近记录</h2>
              <div className="week-visual" aria-label={weekSummary.days ? `最近七条记录来自 ${weekSummary.days} 天` : "还没有记录"}>
                <div className="week-count"><strong>{weekSummary.days ? `${weekSummary.days} 天` : "暂无"}</strong><small>最近 7 条记录</small></div>
                <div className={weekSummary.recent.length ? "week-moods" : "week-moods empty"} aria-hidden="true">
                  {weekSummary.recent.length ? weekSummary.recent.slice().reverse().map((entry) => (
                    <span key={entry.id}>{moodOptions.find((mood) => mood.label === entry.mood)?.label || "已记录"}</span>
                  )) : <span>尚无记录</span>}
                </div>
              </div>
              <p>{entries.length ? `已读取 ${entries.length} 条记录。这里只帮助回看，不计算情绪分数。` : "输入匿名编号后，可以在这里回看自己的记录。"}</p>
              <button type="button" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>查看我的记录</button>
            </section>

            <section className="privacy-card">
              <div className="privacy-icon" aria-hidden="true">选择</div>
              <div>
                <strong>你有选择权</strong>
                <p>可以跳过、导出、删除或停止参加，不影响成绩和获得学校支持。</p>
              </div>
            </section>
          </aside>
        </section>

        {reply && !urgent && <p className="sr-only" role="status" aria-live="polite">AI 建议已准备好。{reply}</p>}
        {(reply || urgent) && (
          <section
            className={urgent ? "reply-section urgent" : "reply-section"}
            aria-labelledby="reply-title"
            aria-live={urgent ? "assertive" : undefined}
            aria-atomic={urgent ? "true" : undefined}
            role={urgent ? "alert" : "region"}
            ref={replyRef}
            tabIndex={urgent ? -1 : undefined}
          >
            <div className="reply-avatar"><Image src="/dog.svg" alt="" width={68} height={68} /></div>
            <div className="reply-body">
              <div className="reply-meta">
                <h2 id="reply-title">{urgent ? "现在先保证安全" : "一条可选的 AI 建议"}</h2>
                <span>{urgent ? "本地安全提示" : `${providerNames[provider] || "AI"} · AI 生成，可能有误`}</span>
              </div>
              <p>{reply}</p>
              {urgent ? (
                <div className="urgent-actions">
                  <a href="tel:110">立即拨打 110</a>
                  <a href="tel:120">立即拨打 120</a>
                  <a href="#help">找可信任的大人</a>
                </div>
              ) : <p className="reply-nudge">这只是一条建议。可以采用、修改或忽略，也可以把小步骤告诉一位信任的老师、家长或同学。</p>}
              {urgent && <small>本研究原型尚不能保证自动通知老师。请你现在主动联系身边可信任的成年人。</small>}
              {!urgent && (
                <>
                  <div className="reply-audio-tools">
                    <div className="cloud-speech-controls" aria-label="Qwen 云端语音朗读控制">
                      <button
                        type="button"
                        className="cloud-speech-primary"
                        disabled={cloudSpeechState === "loading"}
                        aria-pressed={cloudSpeechState === "playing" || cloudSpeechState === "paused"}
                        aria-describedby="cloud-speech-status"
                        onClick={() => void toggleCloudSpeech()}
                      >
                        {cloudSpeechState === "loading" && "正在准备 Qwen 语音…"}
                        {(cloudSpeechState === "idle" || cloudSpeechState === "error") && "使用 Qwen 语音朗读"}
                        {cloudSpeechState === "playing" && "暂停 Qwen 朗读"}
                        {cloudSpeechState === "paused" && "继续 Qwen 朗读"}
                      </button>
                      {(cloudSpeechState === "loading" || cloudSpeechState === "playing" || cloudSpeechState === "paused") && (
                        <button type="button" onClick={() => stopCloudSpeech(cloudSpeechState === "loading" ? "已取消准备云端语音。" : "Qwen 云端朗读已停止。") }>
                          {cloudSpeechState === "loading" ? "取消" : "停止"}
                        </button>
                      )}
                    </div>
                    <p
                      id="cloud-speech-status"
                      className={cloudSpeechState === "error" ? "cloud-speech-status error" : "cloud-speech-status"}
                      role={cloudSpeechState === "error" ? "alert" : "status"}
                      aria-live="polite"
                    >
                      {cloudSpeechMessage || "点击后才会把这条 AI 建议发送到学校配置的 Qwen 语音服务；音频不保存。"}
                    </p>
                    <details className="device-speech-fallback">
                      <summary>设备朗读备用</summary>
                      <div className="speech-controls" aria-label="设备朗读控制">
                        <button
                          type="button"
                          disabled={speechSupported !== true}
                          aria-pressed={speechState !== "idle"}
                          onClick={toggleSpeech}
                        >
                          {speechSupported === false && "此设备不支持朗读"}
                          {speechSupported === null && "正在检查朗读…"}
                          {speechSupported && speechState === "idle" && "使用设备朗读"}
                          {speechSupported && speechState === "speaking" && "暂停设备朗读"}
                          {speechSupported && speechState === "paused" && "继续设备朗读"}
                        </button>
                        {speechState !== "idle" && <button type="button" onClick={stopSpeech}>停止</button>}
                        <span className="sr-only" role="status" aria-live="polite">
                          {speechState === "speaking" ? "正在使用设备朗读 AI 建议" : speechState === "paused" ? "设备朗读已暂停" : "设备朗读已停止"}
                        </span>
                      </div>
                    </details>
                  </div>
                  <div className="reply-closure">
                    <p><strong>今天先记到这里就好。</strong>你不必马上解决全部，需要时可以让现实中的人一起帮忙。</p>
                    <div>
                      <button type="button" onClick={finishSession}>完成今天记录</button>
                      <a href="#help">找现实中的人</a>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {historyOpen && (
          <section className="history-section" aria-labelledby="history-title">
            <div className="section-heading">
              <div>
                <span className="step-label">YOUR RECORDS</span>
                <h2 id="history-title">只属于你的回看</h2>
              </div>
              <div className="history-actions">
                <button type="button" onClick={downloadMyRecords}>导出记录</button>
                <button type="button" className="danger-link" onClick={() => void deleteMyRecords()}>删除全部</button>
                <button type="button" aria-label="收起我的记录" onClick={() => setHistoryOpen(false)}>×</button>
              </div>
            </div>
            {entries.length ? (
              <div className="history-list">
                {entries.map((entry) => (
                  <article key={entry.id}>
                    <div className="history-mood">{moodOptions.find((mood) => mood.label === entry.mood)?.label || "已记录"}</div>
                    <div>
                      <div className="history-meta"><strong>{entry.mood}</strong><time>{formatDate(entry.createdAt)}</time></div>
                      {entry.note && <p>{entry.note}</p>}
                      {entry.goal && <span className="goal-chip">下一步：{entry.goal}</span>}
                      {entry.wantsSupport && <span className="support-chip">已请求真人支持</span>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">还没有记录。今天只选一个心情，也算好好照顾了自己。</div>
            )}
          </section>
        )}

        <section id="help" className="support-section" aria-labelledby="support-title">
          <div>
            <span className="step-label">REAL PEOPLE, REAL SUPPORT</span>
            <h2 id="support-title">有些事，不需要一个人扛。</h2>
            <p>AI 小伴可以帮你理一理，但真正的支持来自现实中的人。你可以从最容易联系的一位开始。</p>
          </div>
          <div className="support-options">
            <article><span aria-hidden="true">师</span><div><strong>学校里的可信任老师</strong><p>班主任、心理教师或学校指定的支持人员</p></div></article>
            <article><span aria-hidden="true">家</span><div><strong>你信任的家人或成年人</strong><p>也可以是亲戚、教练或社工</p></div></article>
            <article className="emergency"><span aria-hidden="true">!</span><div><strong>如果你或别人正面临立即危险</strong><p>请现在拨打 <a href="tel:110">110</a> 或 <a href="tel:120">120</a>，并走到可信任的大人身边</p></div></article>
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-image" aria-hidden="true"><Image src="/dog.svg" alt="" width={42} height={42} /></span><span><strong>心伴 AI-Pet</strong><small>EITT 2026 研究原型</small></span></div>
        <p>学生自我记录 × AI 低压力回应 × 教师人工支持</p>
        <p className="footer-note">本原型不是医疗或心理诊断工具。正式试点需经学校审批、监护人同意与未成年人本人同意。</p>
      </footer>
    </div>
  );
}

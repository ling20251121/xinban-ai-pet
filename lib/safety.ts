export type SafetyLevel = "normal" | "urgent";

const CRISIS_PATTERNS: readonly RegExp[] = [
  /自杀|轻生|想死|不想活(?:了|下去)?|活不下去|不想再醒来|结束(?:自己|我的)?生命/iu,
  /割腕|跳楼|吞(?:药|安眠药)|自残|伤害(?:我)?自己|杀(?:死|了)?自己/iu,
  /suicid(?:e|al)|kill\s+myself|end\s+my\s+life|don['’]?t\s+want\s+to\s+live|hurt\s+myself|self[-\s]?harm/iu,
  /有人(?:要|想)杀我|我现在不安全|马上要伤害我/iu,
  /我(?:现在|马上|今晚)?(?:要|想|准备)(?:杀|捅|砍|勒|毒|伤害)(?:他|她|同学|老师|家人|别人)/iu,
  /(?:他|她|他们|家里人|老师)(?:正在|经常|又在)(?:打|踢|掐|勒|猥亵|性侵|虐待)我/iu,
  /kill\s+(?:him|her|them|someone)|hurt\s+(?:him|her|them|someone)|being\s+(?:abused|assaulted)/iu,
];

export const CRISIS_REPLY =
  "我很在意你刚才说的话。现在请先不要一个人扛：马上去找身边可信任的大人（老师、家长或校医），待在有人陪伴的安全地方，并远离可能伤害自己的物品。如果你正准备伤害自己或已经受伤，请立即拨打 120 或 110，或请身边的大人代拨。你可以只说：‘我现在不安全，需要你陪我。’";

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function excerptAround(value: string, start: number, matchLength: number): string {
  const text = compact(value);
  const left = Math.max(0, start - 24);
  const right = Math.min(text.length, start + matchLength + 24);
  const excerpt = text.slice(left, right);
  return `${left > 0 ? "…" : ""}${excerpt}${right < text.length ? "…" : ""}`;
}

function clipped(value: string, maxCharacters = 72): string {
  const characters = Array.from(compact(value));
  if (characters.length <= maxCharacters) return characters.join("");
  return `${characters.slice(0, maxCharacters).join("")}…`;
}

export interface SafetyAnalysis {
  safetyLevel: SafetyLevel;
  urgent: boolean;
  evidence: string | null;
}

export function analyzeSafety(...values: Array<string | undefined>): SafetyAnalysis {
  const evidence: string[] = [];

  for (const rawValue of values) {
    if (!rawValue) continue;
    const value = compact(rawValue);
    for (const pattern of CRISIS_PATTERNS) {
      const match = pattern.exec(value);
      if (match) {
        evidence.push(excerptAround(value, match.index, match[0].length));
      }
    }
  }

  if (evidence.length === 0) {
    return { safetyLevel: "normal", urgent: false, evidence: null };
  }

  evidence.sort((left, right) => left.length - right.length);
  return {
    safetyLevel: "urgent",
    urgent: true,
    evidence: clipped(evidence[0]),
  };
}

export function buildSupportEvidence(
  wantsSupport: boolean,
  urgentEvidence: string | null,
  note: string,
  goal: string,
): string | null {
  if (urgentEvidence) return clipped(urgentEvidence);
  if (!wantsSupport) return null;

  const candidates = [note, goal].map(compact).filter(Boolean);
  if (candidates.length === 0) return "学生主动请求老师支持";
  candidates.sort((left, right) => left.length - right.length);
  return clipped(candidates[0]);
}

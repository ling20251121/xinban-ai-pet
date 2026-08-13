import { ApiError } from "@/lib/http";

const REDACTION_RULES: readonly [RegExp, string][] = [
  [/(?:https?:\/\/|www\.)\S+/giu, "[已隐藏网址]"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[已隐藏邮箱]"],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/gu, "[已隐藏手机号]"],
  [/(?<!\d)\d{17}[\dXx](?!\d)/gu, "[已隐藏证件号]"],
  [/(?:微信|QQ|手机号|电话|住址|地址|学校|班级|姓名)\s*[:：是为]\s*[^，。；;\n]{1,40}/gu, "[已隐藏身份信息]"],
];

const SANDBOX_PII_PATTERNS: readonly RegExp[] = [
  /(?:https?:\/\/|www\.)\S+/iu,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /(?<!\d)1[3-9]\d{9}(?!\d)/u,
  /(?<!\d)\d{17}[\dXx](?!\d)/u,
  /(?:微信|QQ|手机号|电话|住址|地址|学校|班级|姓名|学号)\s*[:：是为]\s*[^，。；;\n]{1,40}/u,
];

const SPOKEN_DIGIT = /[〇零一二两三四五六七八九幺]/u;
const SPOKEN_DIGIT_RUN = /[〇零一二两三四五六七八九幺](?:[\s，,、.。\-—]*[〇零一二两三四五六七八九幺]){10,17}/gu;
const SPOKEN_DIGIT_VALUES: Readonly<Record<string, string>> = {
  "〇": "0", "零": "0", "一": "1", "幺": "1", "二": "2", "两": "2",
  "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9",
};

const UNSAFE_OUTPUT_PATTERNS: readonly RegExp[] = [
  /只有我(?:懂|理解|陪)|我会永远陪|不需要(?:老师|家长|大人)|别告诉(?:别人|老师|家长)|替你保密/iu,
  /你(?:患有|得了|就是)(?:抑郁|焦虑|精神|人格)|确诊|临床诊断/iu,
  /(?:割腕|跳楼|上吊|服药|自残|自杀|伤害别人).{0,24}(?:方法|步骤|可以|试试|技巧)/iu,
  /```|<\/?[a-z][^>]*>|(?:https?:\/\/|www\.)/iu,
];

function clean(value: string): string {
  const withoutControls = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 10 || code === 13 || code === 9 || (code >= 32 && code !== 127);
    })
    .join("");
  return withoutControls
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function containsSpokenPhoneOrId(value: string): boolean {
  if (!SPOKEN_DIGIT.test(value)) return false;
  for (const match of value.matchAll(SPOKEN_DIGIT_RUN)) {
    const digits = Array.from(match[0])
      .map((character) => SPOKEN_DIGIT_VALUES[character] ?? "")
      .join("");
    if (/^1[3-9]\d{9}$/u.test(digits) || /^\d{17}[\dXx]$/u.test(digits)) return true;
  }
  return false;
}

export function prepareStudentText(value: string, maxCharacters: number): string {
  let prepared = clean(value).normalize("NFKC");
  for (const [pattern, replacement] of REDACTION_RULES) {
    prepared = prepared.replace(pattern, replacement);
  }
  // ASR commonly emits phone or ID digits as Chinese words separated by
  // punctuation. Redact the whole run before any text is sent to Qwen, even
  // outside the adult synthetic sandbox where input is not hard-rejected.
  prepared = prepared.replace(SPOKEN_DIGIT_RUN, (match) => {
    const digits = Array.from(match)
      .map((character) => SPOKEN_DIGIT_VALUES[character] ?? "")
      .join("");
    if (/^1[3-9]\d{9}$/u.test(digits)) return "[已隐藏手机号]";
    if (/^\d{17}[\dXx]$/u.test(digits)) return "[已隐藏证件号]";
    return match;
  });
  return Array.from(prepared).slice(0, maxCharacters).join("");
}

/** Sandbox input is rejected, never merely redacted, when it resembles PII. */
export function rejectSandboxPersonalInformation(...values: string[]): void {
  if (
    values.some((value) =>
      SANDBOX_PII_PATTERNS.some((pattern) => pattern.test(value.normalize("NFKC"))) ||
      containsSpokenPhoneOrId(value.normalize("NFKC")),
    )
  ) {
    throw new ApiError(
      400,
      "合成沙盒禁止输入真实姓名、学校、班级、学号、电话、邮箱、地址或账号信息。请改用完全虚构的表达。",
    );
  }
}

export function validateCompanionOutput(value: string): string {
  const output = clean(value);
  const characters = Array.from(output);
  if (!output || characters.length > 240) {
    throw new ApiError(502, "AI 回复未通过安全检查，请稍后再试。");
  }
  if (UNSAFE_OUTPUT_PATTERNS.some((pattern) => pattern.test(output))) {
    throw new ApiError(502, "AI 回复未通过安全检查，请稍后再试。");
  }

  const numbersWithoutEmergency = output.replace(/110|120/g, "");
  if (/(?<!\d)\d{4,}(?!\d)/u.test(numbersWithoutEmergency)) {
    throw new ApiError(502, "AI 回复未通过安全检查，请稍后再试。");
  }
  const sentenceCount = output.split(/[。！？!?]+/u).filter(Boolean).length;
  if (sentenceCount > 4) {
    throw new ApiError(502, "AI 回复未通过安全检查，请稍后再试。");
  }
  return output;
}

export function validateSpeechText(value: string): string {
  return validateCompanionOutput(value);
}

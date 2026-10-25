const CHINESE_LOCALES = new Set(["zh", "zh-cn", "zh-sg", "zh-hans", "zh-tw", "zh-hk", "zh-hant"]);

export function normalizeAnswerLanguage(value, fallback = "zh-CN") {
  const normalized = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) return fallback;
  if (CHINESE_LOCALES.has(normalized) || normalized.startsWith("zh-")) {
    return normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-hant" ? "zh-TW" : "zh-CN";
  }
  if (normalized.startsWith("en")) return "en-US";
  if (normalized.startsWith("ja")) return "ja-JP";
  if (normalized.startsWith("ko")) return "ko-KR";
  return value;
}

export function buildLanguagePolicy(value) {
  const language = normalizeAnswerLanguage(value);
  if (language === "zh-CN") {
    return [
      "回答语言硬约束：必须使用简体中文回答，即使面试官使用英文或材料为英文。",
      "代码标识符、API 名称、库名、协议名和没有通行中文译名的标准技术术语保留英文。",
      "提示、解释、错误说明、追问建议和口述答案均使用自然、简洁的简体中文。",
    ].join("\n");
  }
  if (language === "zh-TW") {
    return "回答語言硬約束：必須使用繁體中文回答；程式碼識別字、API 與標準技術名詞可保留英文。";
  }
  if (language === "en-US") {
    return "Hard language constraint: answer in clear, natural English even when the question or source material is in another language. Keep code identifiers unchanged.";
  }
  return `回答语言硬约束：必须使用 ${language} 回答；代码标识符、API 和标准技术名词可保留原文。`;
}

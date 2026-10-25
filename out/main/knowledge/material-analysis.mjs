import { createHash } from "node:crypto";

const SECTION_RULES = [
  ["responsibilities", /(?:岗位职责|工作职责|职责描述|你将负责|主要职责|responsibilit|what you.?ll do)/i],
  ["mustHaveSkills", /(?:任职要求|岗位要求|基本要求|必备|必须|required|qualification|what we.?re looking for)/i],
  ["preferredSkills", /(?:加分项|优先|最好|preferred|nice to have|bonus)/i],
  ["softSkills", /(?:沟通|协作|推动|领导|抗压|责任心|communication|collaboration|leadership)/i],
  ["languageRequirements", /(?:英语|英文|普通话|日语|语言能力|english|mandarin|japanese)/i],
];

export function contentHash(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function analyzeJobDescription(text, sourceAssetId = null) {
  const lines = normalizedLines(text);
  const result = {
    roleTitle: detectRoleTitle(lines),
    roleFamily: detectRoleFamily(lines),
    seniority: detectSeniority(lines),
    domains: [],
    responsibilities: [],
    mustHaveSkills: [],
    preferredSkills: [],
    softSkills: [],
    yearsRequirements: [],
    languageRequirements: [],
    ambiguities: [],
    conflicts: [],
    sourceAssetId,
    sourceHash: contentHash(text),
  };
  let section = "responsibilities";
  for (const line of lines) {
    const headingRule = SECTION_RULES.find(([, pattern]) => isHeading(line.text) && pattern.test(line.text));
    if (headingRule) {
      section = headingRule[0];
      continue;
    }
    if (!isMeaningfulEvidenceLine(line.text)) continue;
    const evidence = evidenceRecord("JD", line, section === "preferredSkills" ? "explicit_preferred" : "explicit");
    if (/(?:\d+\s*(?:年|年以上|years?))/i.test(line.text)) result.yearsRequirements.push(evidence);
    if (/(?:英语|英文|普通话|日语|语言能力|english|mandarin|japanese)/i.test(line.text)) result.languageRequirements.push(evidence);
    if (/(?:沟通|协作|推动|领导|抗压|责任心|communication|collaboration|leadership)/i.test(line.text)) result.softSkills.push(evidence);
    const inferredSection = SECTION_RULES.find(([, pattern]) => pattern.test(line.text))?.[0] ?? section;
    if (Array.isArray(result[inferredSection])) result[inferredSection].push(evidence);
    for (const domain of detectDomains(line.text)) addUniqueText(result.domains, { ...evidence, text: domain, classification: "inferred" });
  }
  for (const key of ["responsibilities", "mustHaveSkills", "preferredSkills", "softSkills", "yearsRequirements", "languageRequirements", "domains"]) {
    result[key] = dedupeEvidence(result[key]).slice(0, 40);
  }
  if (!result.roleTitle) result.ambiguities.push("未能从 JD 中可靠识别岗位名称。");
  if (!result.mustHaveSkills.length) result.ambiguities.push("未识别到明确的必备要求，请人工确认 JD 标题层级。");
  const requiredYears = result.yearsRequirements.map((item) => Number(item.text.match(/\d+/)?.[0])).filter(Number.isFinite);
  if (requiredYears.length > 1 && Math.max(...requiredYears) - Math.min(...requiredYears) >= 3) {
    result.conflicts.push("JD 中出现跨度较大的年限要求，可能对应不同技能或职级，需要人工确认。");
  }
  return result;
}

export function analyzeCandidateMaterial(text, sourceAssetId = null) {
  const lines = normalizedLines(text);
  const facts = [];
  let section = "profile";
  for (const line of lines) {
    if (isHeading(line.text)) {
      section = classifyResumeSection(line.text);
      continue;
    }
    if (!isMeaningfulEvidenceLine(line.text)) continue;
    facts.push({
      ...evidenceRecord("RESUME", line, "explicit"),
      category: section,
      metrics: line.text.match(/\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s*(?:ms|s|qps|tps|万|亿|人|台|个)/gi) ?? [],
    });
  }
  return {
    sourceAssetId,
    sourceHash: contentHash(text),
    skills: collectSkillFacts(facts),
    projects: facts.filter((item) => item.category === "project").slice(0, 60),
    experience: facts.filter((item) => item.category === "experience").slice(0, 60),
    education: facts.filter((item) => item.category === "education").slice(0, 30),
    facts: facts.slice(0, 180),
  };
}

export function selectRelevantEvidence(analysis, query, limit = 8) {
  if (!analysis) return [];
  const candidates = analysis.facts
    ?? [
      ...(analysis.mustHaveSkills ?? []),
      ...(analysis.preferredSkills ?? []),
      ...(analysis.responsibilities ?? []),
      ...(analysis.softSkills ?? []),
      ...(analysis.domains ?? []),
    ];
  const terms = tokenize(query);
  return [...candidates]
    .map((item) => ({ item, score: overlapScore(tokenize(item.text), terms) }))
    .sort((left, right) => right.score - left.score || left.item.lineStart - right.item.lineStart)
    .slice(0, Math.max(1, limit))
    .map(({ item }) => item);
}

export function formatJobRuntimePack(profile, query = "") {
  if (!profile) return "";
  const relevant = selectRelevantEvidence(profile, query, 10);
  const top = relevant.length ? relevant : [...(profile.mustHaveSkills ?? []), ...(profile.responsibilities ?? [])].slice(0, 10);
  return [
    `岗位：${profile.roleTitle || "未明确"}；方向：${profile.roleFamily || "未明确"}；职级：${profile.seniority || "未明确"}`,
    ...top.map((item) => `- [${item.evidenceId}] ${item.text}`),
    ...(profile.ambiguities?.length ? [`待确认：${profile.ambiguities.join("；")}`] : []),
  ].join("\n");
}

function normalizedLines(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((text, index) => splitEvidenceLine(text.replace(/[ \t]+/g, " ").trim(), index + 1));
}

function evidenceRecord(prefix, line, classification) {
  const segmentSuffix = line.segmentCount > 1 ? `:S${line.segmentIndex + 1}` : "";
  return {
    text: line.text,
    evidenceId: `${prefix}:L${line.lineStart}-L${line.lineEnd}${segmentSuffix}`,
    lineStart: line.lineStart,
    lineEnd: line.lineEnd,
    confidence: classification === "inferred" ? 0.65 : 0.92,
    classification,
  };
}

function splitEvidenceLine(text, lineNumber) {
  if (!text) return [];
  const maxLength = 560;
  if (text.length <= maxLength) {
    return [{ text, lineStart: lineNumber, lineEnd: lineNumber, segmentIndex: 0, segmentCount: 1 }];
  }
  const segments = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const candidates = [window.lastIndexOf("。"), window.lastIndexOf("；"), window.lastIndexOf("，"), window.lastIndexOf(" ")];
    const boundary = Math.max(...candidates.filter((value) => value >= Math.floor(maxLength * 0.55)));
    const take = boundary > 0 ? boundary + 1 : maxLength;
    segments.push(remaining.slice(0, take).trim());
    remaining = remaining.slice(take).trim();
  }
  if (remaining) segments.push(remaining);
  return segments.filter(Boolean).map((segment, segmentIndex) => ({
    text: segment,
    lineStart: lineNumber,
    lineEnd: lineNumber,
    segmentIndex,
    segmentCount: segments.length,
  }));
}

function detectRoleTitle(lines) {
  const explicit = lines.find((line) => /(?:职位|岗位|position|role)\s*[:：]/i.test(line.text));
  if (explicit) return explicit.text.split(/[:：]/).slice(1).join(":").trim().slice(0, 120);
  const candidate = lines.slice(0, 8).find((line) => /(?:工程师|开发|架构师|经理|总监|专家|scientist|engineer|developer|architect|manager)/i.test(line.text));
  return candidate?.text.replace(/^#+\s*/, "").slice(0, 120) ?? "";
}

function detectRoleFamily(lines) {
  const text = lines.slice(0, 80).map((line) => line.text).join(" ");
  if (/(?:前端|react|vue|frontend)/i.test(text)) return "前端工程";
  if (/(?:后端|java|golang|go语言|spring|backend)/i.test(text)) return "后端工程";
  if (/(?:全栈|full.?stack)/i.test(text)) return "全栈工程";
  if (/(?:算法|机器学习|深度学习|llm|ai engineer|machine learning)/i.test(text)) return "AI / 算法";
  if (/(?:测试|qa|quality assurance)/i.test(text)) return "测试与质量";
  if (/(?:运维|devops|sre|可靠性)/i.test(text)) return "DevOps / SRE";
  return "";
}

function detectSeniority(lines) {
  const text = lines.slice(0, 40).map((line) => line.text).join(" ");
  if (/(?:专家|资深|高级|senior|staff|principal|lead)/i.test(text)) return "高级";
  if (/(?:应届|校招|实习|junior|intern|graduate)/i.test(text)) return "初级";
  const years = [...text.matchAll(/(\d+)\s*(?:年|years?)/gi)].map((match) => Number(match[1]));
  if (years.some((value) => value >= 5)) return "高级";
  if (years.some((value) => value >= 2)) return "中级";
  return "";
}

function detectDomains(text) {
  const rules = [
    ["电商", /电商|commerce/i], ["金融", /金融|支付|fintech|payment/i], ["云原生", /云原生|kubernetes|k8s|container/i],
    ["大数据", /大数据|spark|flink|data platform/i], ["AI", /人工智能|机器学习|llm|ai\b/i], ["安全", /安全|security/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function classifyResumeSection(value) {
  if (/(?:项目|project)/i.test(value)) return "project";
  if (/(?:工作|经历|experience|employment)/i.test(value)) return "experience";
  if (/(?:技能|技术栈|skills?)/i.test(value)) return "skill";
  if (/(?:教育|学历|education)/i.test(value)) return "education";
  return "profile";
}

function collectSkillFacts(facts) {
  const skillPattern = /\b(?:JavaScript|TypeScript|Python|Java|Go|Rust|C\+\+|React|Vue|Angular|Node\.js|Spring|Django|FastAPI|MySQL|PostgreSQL|Redis|Kafka|Docker|Kubernetes|AWS|Azure|GCP|Git)\b/gi;
  const seen = new Set();
  const result = [];
  for (const fact of facts) {
    for (const match of fact.text.match(skillPattern) ?? []) {
      const key = match.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...fact, text: match });
    }
  }
  return result;
}

function isHeading(text) {
  return /^#{1,6}\s+/.test(text) || /^(?:岗位职责|工作职责|任职要求|岗位要求|加分项|技能|项目经历|工作经历|教育经历|responsibilities|requirements|qualifications|preferred|skills|projects?|experience|education)\s*[:：]?$/i.test(text);
}

function isMeaningfulEvidenceLine(text) {
  return text.length >= 6 && !/^(?:[-=*#_]{3,}|\d{1,2})$/.test(text);
}

function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addUniqueText(items, next) {
  if (!items.some((item) => item.text === next.text)) items.push(next);
}

function tokenize(value) {
  return new Set(String(value ?? "").normalize("NFKC").toLowerCase().match(/[a-z0-9_+.#-]{2,}|[\p{Script=Han}]{1,4}/gu) ?? []);
}

function overlapScore(left, right) {
  if (!right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += token.length > 1 ? 2 : 1;
  return overlap;
}

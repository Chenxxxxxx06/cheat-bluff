import { createHash } from "node:crypto";
import {validateSpokenAnswers,hasPersonalClaim,cardAnswerTexts} from './spoken-answer.mjs';

const digest = value => createHash("sha256").update(value).digest("hex");
const required = (value, label, limit) => {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`${label}为空或超过长度限制。`);
  return value.trim();
};
const strings = (value, limit = 16) => (Array.isArray(value) ? value : []).slice(0, limit).map(v => required(v, "条目", 800));

// This checks provenance, not semantic truth or personal authorship. No paths are read here.
export function validateCuratedPackage(input) {
  if (input?.version !== 1) throw new Error("不支持的知识包版本。");
  const packageId = required(input.packageId, "知识包标识", 100);
  if (!/^[a-z0-9._-]+$/i.test(packageId)) throw new Error("知识包标识格式错误。");
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 300
      || !Array.isArray(input.cards) || !input.cards.length || input.cards.length > 500) throw new Error("知识包需要 1–300 份来源和 1–500 张知识卡。");
  const sources = input.sources.map(s => ({
    key: required(s.key, "来源标识", 700), name: required(s.name, "来源名称", 240),
    path: typeof s.path === "string" ? s.path.slice(0, 500) : "",
    lineOffset: Number.isInteger(s.lineOffset) && s.lineOffset>=0 ? s.lineOffset : 0,
    content: (required(s.content, "来源正文", 240000), s.content.replace(/\r\n/g, "\n")),
    relationship: s.relationship === "mine" ? "mine" : "reference",
  }));
  if (sources.reduce((n,s) => n + s.content.length, 0) > 12_000_000) throw new Error("单次知识包最多 1200 万字符。");
  const byKey = new Map(sources.map(s => [s.key, s]));
  if (byKey.size !== sources.length) throw new Error("知识包包含重复来源标识。");
  const ids = new Set();
  const cards = input.cards.map(c => {
    const externalId = required(c.id, "知识卡标识", 120);
    if (ids.has(externalId)) throw new Error("知识卡标识重复。"); ids.add(externalId);
    const summary = required(c.answer ?? c.summary, "知识卡正文", 5000);
    const spokenAnswers = validateSpokenAnswers(c.spokenAnswers);
    if (!Array.isArray(c.evidence) || !c.evidence.length || c.evidence.length > 16) throw new Error(`知识卡 ${externalId} 缺少原始证据。`);
    const evidence = c.evidence.map(e => {
      const sourceKey = e.sourceKey ?? e.path;
      const source = byKey.get(sourceKey);
      if (!source) throw new Error(`知识卡 ${externalId} 引用了不存在的来源。`);
      const quote = required(e.quote, "原文引用", 5000).replace(/\r\n/g, "\n");
      const lines = source.content.split("\n");
      const startLine = e.startLine, endLine = e.endLine;
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length
          || quote.length < 12 || !lines.slice(startLine - 1, endLine).join("\n").includes(quote)) throw new Error(`知识卡 ${externalId} 的引用或行号无法在原文定位。`);
      return { sourceKey, quote, startLine, endLine, originalStartLine:startLine+source.lineOffset,originalEndLine:endLine+source.lineOffset,sourceHash: digest(source.content), sourcePath:source.path,
        sourceUrl: typeof e.sourceUrl === "string" && /^https?:\/\//.test(e.sourceUrl) ? e.sourceUrl.slice(0,1000) : null };
    });
    // Catch positive first-person assertions, not boundary notes such as “不能推断本人独立完成”.
    const resumeBacked = c.contributionStatus==='resume_stated' && evidence.some(e=>{
      const source=byKey.get(e.sourceKey);return /resume|简历/i.test(`${source?.key} ${source?.path} ${source?.name}`);
    });
    const personal = c.kind === "personal" || (!resumeBacked && cardAnswerTexts({summary,spokenAnswers}).some(hasPersonalClaim));
    return {externalId, title:required(c.title, "知识卡标题", 160), summary, ...(spokenAnswers ? {spokenAnswers} : {}),
      project:required(c.project || packageId, "项目", 100), question:required(c.question, "问题", 500),
      aliases:strings(c.aliases), followUps:strings(c.followUps), uncertainties:strings(c.uncertainties),
      tags:strings(c.tags ?? [c.project || packageId], 12), evidence,
      kind:personal ? "personal" : "knowledge", status:personal ? "needs_confirmation" : "ready",
      contributionStatus:["technical_only","resume_stated","pending"].includes(c.contributionStatus) ? c.contributionStatus : "pending"};
  });
  return {packageId, sources, cards, digest:digest(JSON.stringify({sources,cards}))};
}

export function curatedCardText(card, source) {
  const attribution = card.kind === "personal" ? "用户确认的个人经历" : "技术资料；实现存在不证明个人完成，个人职责以简历自述为界";
  return [`# ${card.project || ""} ${card.title}`, `归属：${attribution}`,
    `## ${card.question}`, card.summary,
    card.uncertainties?.length ? `待确认与限制：${card.uncertainties.join("；")}` : "",
    `相关问法：${(card.aliases ?? []).join("；")}`, `追问：${(card.followUps ?? []).join("；")}`,
    `标签：${card.tags.join("、")}`,
    ...(card.evidence?.length ? card.evidence.map(e => `证据：${e.sourcePath || source?.name} 原文件 L${e.originalStartLine??e.startLine}–L${e.originalEndLine??e.endLine}\n${e.quote.slice(0,700)}`)
      : [`原文：${card.quote}`, `来源：${source?.name} L${card.lineStart}–L${card.lineEnd}`]),
  ].filter(Boolean).join("\n\n");
}

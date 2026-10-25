import { randomUUID } from "node:crypto";
import { buildLanguagePolicy } from "../prompts/language-policy.mjs";
import { EVIDENCE_POLICY, UNTRUSTED_MATERIAL_POLICY } from "../prompts/base-policy.mjs";

const MAX_CARDS = 12;

export async function generateVerifiedInterviewCards({
  aiService,
  language = "zh-CN",
  jobProfile = null,
  candidateProfile = null,
  retrieval = null,
  existingCards = [],
  requestedCount = 6,
  signal = null,
}) {
  const evidence = collectEvidence(jobProfile, candidateProfile, retrieval);
  if (!evidence.length) throw new Error("没有可用于验证问答卡的事实证据。请先解析简历、JD、项目说明或代码仓库。");
  const count = Math.max(1, Math.min(MAX_CARDS, Number(requestedCount) || 6));
  const evidenceText = evidence.map((item) => `[${item.id}] ${item.text}`).join("\n");
  const languagePolicy = buildLanguagePolicy(language);
  const questions = await runJsonAgent(aiService, {
    role: "面试官 Agent",
    instruction: `根据岗位要求和证据设计 ${count} 个高概率问题。覆盖项目、技术、追问和行为题。只输出 JSON：{"questions":[{"question":"...","intent":"...","evidenceIds":["..."]}]}。`,
    context: evidenceText,
    signal,
  });
  const normalizedQuestions = normalizeQuestions(questions?.questions, evidence, count);
  const answers = await runJsonAgent(aiService, {
    role: "候选人 Agent",
    instruction: [
      `为这些问题生成简洁、可口述的回答。${languagePolicy}`,
      EVIDENCE_POLICY,
      "只输出 JSON：{\"cards\":[{\"question\":\"...\",\"answer\":\"...\",\"evidenceIds\":[\"...\"],\"keywords\":[\"...\"]}]}。",
    ].join("\n"),
    context: `问题：\n${JSON.stringify(normalizedQuestions)}\n\n证据：\n${evidenceText}`,
    signal,
  });
  let cards = normalizeCandidateCards(answers?.cards, normalizedQuestions, evidence);
  const challenge = await runJsonAgent(aiService, {
    role: "追问 Agent",
    instruction: "对每张卡提出最容易暴露空泛、夸大或上下文缺失的追问，并给出应补强点。只输出 JSON：{\"reviews\":[{\"question\":\"...\",\"followUps\":[\"...\"],\"weaknesses\":[\"...\"]}]}。",
    context: JSON.stringify(cards),
    signal,
  });
  cards = mergeChallenges(cards, challenge?.reviews);
  const audit = await runJsonAgent(aiService, {
    role: "审核 Agent",
    instruction: [
      "逐卡核对回答中的个人经历、职责和数字是否被 evidenceIds 支持。材料之外的技术常识可以保留，但不能伪装成个人事实。",
      UNTRUSTED_MATERIAL_POLICY,
      "只输出 JSON：{\"audits\":[{\"question\":\"...\",\"verdict\":\"pass|revise|reject\",\"safeAnswer\":\"...\",\"evidenceIds\":[\"...\"],\"reason\":\"...\"}]}。",
    ].join("\n"),
    context: `待审核卡片：\n${JSON.stringify(cards)}\n\n允许使用的证据：\n${evidenceText}`,
    signal,
  });
  cards = applyAudit(cards, audit?.audits, evidence);
  const now = new Date().toISOString();
  const previousByQuestion = new Map(existingCards.map((card) => [normalizeKey(card.question), card]));
  return cards.map((card) => ({
    id: previousByQuestion.get(normalizeKey(card.question))?.id ?? randomUUID(),
    question: card.question,
    answer: card.answer,
    keywords: card.keywords,
    followUps: card.followUps,
    weaknesses: card.weaknesses,
    evidenceIds: card.evidenceIds,
    verification: card.verification,
    source: "agent_generated_not_fact",
    createdAt: previousByQuestion.get(normalizeKey(card.question))?.createdAt ?? now,
    updatedAt: now,
  }));
}

export function selectInterviewCards(cards, query, limit = 3) {
  const terms = tokenize(query);
  return (cards ?? [])
    .filter((card) => card.verification?.status === "verified")
    .map((card) => ({ card, score: scoreCard(card, terms) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map(({ card }) => card);
}

export function formatInterviewCards(cards) {
  if (!cards?.length) return "";
  return [
    "已验证问答卡（模型生成内容，不是新的事实来源；只可在所列证据范围内复用）：",
    ...cards.map((card, index) => [
      `[CARD-${index + 1}] 问：${card.question}`,
      `答：${card.answer}`,
      `证据：${card.evidenceIds.join("、")}`,
      card.followUps?.length ? `可能追问：${card.followUps.join("；")}` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

function collectEvidence(jobProfile, candidateProfile, retrieval) {
  const values = [];
  const add = (id, text, kind) => {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
    if (!id || !clean || values.some((item) => item.id === id)) return;
    values.push({ id, text: clean, kind });
  };
  for (const item of candidateProfile?.facts ?? []) add(item.evidenceId, item.text, "candidate");
  for (const key of ["mustHaveSkills", "preferredSkills", "responsibilities", "softSkills", "domains"]) {
    for (const item of jobProfile?.[key] ?? []) add(item.evidenceId, item.text, "job");
  }
  for (const citation of retrieval?.citations ?? []) add(citation.evidenceId ?? `KB:${citation.documentId}:${citation.ordinal}`, citation.snippet, citation.sourceType ?? "knowledge");
  return values.slice(0, 120);
}

async function runJsonAgent(aiService, { role, instruction, context, signal }) {
  if (signal?.aborted) throw signal.reason ?? new Error("问答卡生成已取消。");
  const raw = await aiService.complete({
    messages: [
      { role: "system", content: `${role}\n${instruction}\n${UNTRUSTED_MATERIAL_POLICY}\n输出必须是严格 JSON，不要 Markdown 代码块。` },
      { role: "user", content: context },
    ],
    signal,
  });
  if (signal?.aborted) throw signal.reason ?? new Error("问答卡生成已取消。");
  return parseJson(raw);
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function normalizeQuestions(input, evidence, count) {
  const allowed = new Set(evidence.map((item) => item.id));
  const result = [];
  for (const item of Array.isArray(input) ? input : []) {
    const question = String(item?.question ?? "").trim().slice(0, 400);
    if (!question) continue;
    result.push({
      question,
      intent: String(item?.intent ?? "考察与岗位匹配的真实能力").slice(0, 240),
      evidenceIds: (item?.evidenceIds ?? []).filter((id) => allowed.has(id)).slice(0, 8),
    });
    if (result.length >= count) break;
  }
  if (!result.length) {
    for (const item of evidence.slice(0, count)) result.push({
      question: `请结合真实经历说明你对“${item.text.slice(0, 50)}”的理解或实践。`,
      intent: "验证材料中的关键事实",
      evidenceIds: [item.id],
    });
  }
  return result;
}

function normalizeCandidateCards(input, questions, evidence) {
  const allowed = new Set(evidence.map((item) => item.id));
  const byQuestion = new Map((Array.isArray(input) ? input : []).map((item) => [normalizeKey(item?.question), item]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return questions.map((question) => {
    const candidate = byQuestion.get(normalizeKey(question.question));
    const evidenceIds = [...new Set([...(candidate?.evidenceIds ?? []), ...question.evidenceIds])].filter((id) => allowed.has(id)).slice(0, 8);
    const fallbackAnswer = evidenceIds.length
      ? evidenceIds.map((id) => evidenceById.get(id)?.text).filter(Boolean).join("；")
      : "现有材料不足以支持个人经历型回答，需要先补充真实案例。";
    return {
      question: question.question,
      answer: String(candidate?.answer ?? fallbackAnswer).trim().slice(0, 2_400),
      keywords: (candidate?.keywords ?? []).map(String).map((item) => item.slice(0, 80)).slice(0, 10),
      evidenceIds,
      followUps: [],
      weaknesses: [],
      verification: { status: "pending", reason: "等待审核 Agent 验证。" },
    };
  });
}

function mergeChallenges(cards, reviews) {
  const byQuestion = new Map((Array.isArray(reviews) ? reviews : []).map((item) => [normalizeKey(item?.question), item]));
  return cards.map((card) => {
    const review = byQuestion.get(normalizeKey(card.question));
    return {
      ...card,
      followUps: (review?.followUps ?? []).map(String).map((item) => item.slice(0, 400)).slice(0, 5),
      weaknesses: (review?.weaknesses ?? []).map(String).map((item) => item.slice(0, 400)).slice(0, 5),
    };
  });
}

function applyAudit(cards, audits, evidence) {
  const allowed = new Set(evidence.map((item) => item.id));
  const byQuestion = new Map((Array.isArray(audits) ? audits : []).map((item) => [normalizeKey(item?.question), item]));
  return cards.map((card) => {
    const audit = byQuestion.get(normalizeKey(card.question));
    const auditedIds = (audit?.evidenceIds ?? card.evidenceIds).filter((id) => allowed.has(id));
    const requestedVerdict = String(audit?.verdict ?? "").toLowerCase();
    const hasEvidence = auditedIds.length > 0;
    const status = requestedVerdict === "pass" && hasEvidence ? "verified" : requestedVerdict === "reject" ? "rejected" : "needs_review";
    return {
      ...card,
      answer: String(audit?.safeAnswer ?? card.answer).trim().slice(0, 2_400),
      evidenceIds: auditedIds,
      verification: {
        status,
        reason: String(audit?.reason ?? (hasEvidence ? "审核结果不完整，需要人工复核。" : "没有有效证据 ID。 ")).slice(0, 600),
        auditedAt: new Date().toISOString(),
      },
    };
  });
}

function normalizeKey(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function tokenize(value) {
  const normalized = String(value ?? "").normalize("NFKC").toLowerCase();
  const terms = new Set(normalized.match(/[a-z0-9_+.#-]{2,}/gu) ?? []);
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return terms;
}

function scoreCard(card, queryTerms) {
  const textTerms = tokenize(`${card.question} ${(card.keywords ?? []).join(" ")} ${(card.followUps ?? []).join(" ")}`);
  let score = 0;
  for (const term of textTerms) if (queryTerms.has(term)) score += 1;
  return score;
}

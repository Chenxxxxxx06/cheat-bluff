import {isSkillExperienceQuestion} from './answer-style.mjs';
import {splitQuestionParts} from './question-parts.mjs';
import {asksPersonalContribution} from './conversation-context.mjs';
import {spokenAnswer,PROJECT_NAMES,hasPersonalClaim,cardAnswerTexts} from './spoken-answer.mjs';
const HIGH_CONFIDENCE_THRESHOLD = 0.82;
// The local BM25 pass is fast enough to inspect a slightly wider window. This
// matters for named-project cards with specific names that can sit behind
// generic "project introduction" index entries while still arriving well
// inside the 100 ms direct-card budget.
const TOP_CITATION_LIMIT = 12;

const ANSWER_LENGTH_PROFILES = Object.freeze({
  quick: Object.freeze({
    value: "quick",
    maxTokens: 160,
    cardMaxChars: 120,
    prompt: "采用快速回答：只续写结论和 3 个关键词，控制在约 120 个中文字符内。",
  }),
  standard: Object.freeze({
    value: "standard",
    maxTokens: 360,
    cardMaxChars: 180,
    prompt: "采用标准回答：按问题、方案、结果、取舍续写，控制在约 250 到 450 个中文字符。",
  }),
  deep: Object.freeze({
    value: "deep",
    maxTokens: 800,
    cardMaxChars: 320,
    prompt: "采用深度回答：在不重复已显示短卡的前提下，补充架构、关键源码、消融或对比验证、失败案例与边界，控制在约 500 到 900 个中文字符。",
  }),
});

const INTENT_RULES = Object.freeze([
  ["strengths_weaknesses", /(?:优缺点|优势.{0,8}(?:不足|缺点)|(?:不足|缺点).{0,8}优势|strengths?\s+and\s+weakness)/iu],
  ["self_intro", /(?:自我介绍|介绍(?:一下)?(?:你自己|自己)|介绍一下你(?:[。！？?!]|$)|简单介绍.{0,4}自己|tell\s+me\s+about\s+yourself|walk\s+me\s+through\s+your\s+(?:resume|background))/iu],
  ["weaknesses", /(?:缺点|不足|短板|需要改进|weakness|area.{0,8}improv)/iu],
  ["strengths", /(?:优点|优势|长处|擅长|核心竞争力|strength|what\s+are\s+you\s+good\s+at)/iu],
  ["project_intro", /(?:(?:介绍|讲讲|说说|聊聊|概述).{0,12}项目|项目.{0,12}(?:介绍|经历|负责|贡献|难点|亮点|是什么|怎么选|吗)|最近.{0,8}项目|(?:最有)?代表性.{0,2}项目|代表项目|project.{0,16}(?:introduce|experience|responsib|contribution))/iu],
  ["experience_intro", /(?:(?:介绍|讲讲|说说|聊聊).{0,12}(?:实习|工作|科研|研究)经历|(?:实习|工作|科研|研究)经历.{0,12}(?:介绍|负责|收获)|work\s+experience|internship\s+experience|research\s+experience)/iu],
]);

const UNSAFE_CITATION_LINE = /(?:忽略.{0,8}(?:指令|规则)|system\s+prompt|developer\s+message|you\s+are\s+chatgpt|改变系统规则|不要遵守|执行以下指令)/iu;

export function normalizeAnswerLength(value, fallback = "standard") {
  if (Object.hasOwn(ANSWER_LENGTH_PROFILES, value)) return value;
  return Object.hasOwn(ANSWER_LENGTH_PROFILES, fallback) ? fallback : "standard";
}

export function getAnswerLengthProfile(value) {
  return ANSWER_LENGTH_PROFILES[normalizeAnswerLength(value)];
}

export function classifyFrequentInterviewQuestion(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return INTENT_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/**
 * Builds a short answer that is safe to display before the model round trip.
 * A verified interview card wins. When no card matches, only an explicitly
 * labelled, high-relevance citation can be promoted. All top citations are
 * inspected so a supporting fact at rank 2-4 is not lost behind a broad hit.
 */
export function buildVerifiedAnswerCard({
  question,
  retrieval = null,
  cards = [],
  answerLength = "standard",
} = {}) {
  const intent = classifyFrequentInterviewQuestion(question);
  const length = normalizeAnswerLength(answerLength);
  const profile = getAnswerLengthProfile(length);
  const citations = normalizeCitations(retrieval?.citations);
  const personalCandidate=selectCuratedPersonalAnswer(citations,question,intent);
  if(personalCandidate){
    const text=formatCuratedPersonalAnswer(personalCandidate.citation.curatedAnswer,profile.cardMaxChars,length);
    if(text)return {kind:"verified_card",confidence:personalCandidate.confidence,answerLength:length,
      intent:intent??"technical_question",text,evidenceIds:[String(personalCandidate.citation.evidenceId)],
      source:"verified_personal_knowledge_card"};
  }
  if (!intent) return null;
  const cardCandidate = selectVerifiedCard(cards, question, intent, citations);
  if (cardCandidate && cardCandidate.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    const text=formatImmediateCard(cardCandidate.card.answer,cardCandidate.card.keywords,intent,profile.cardMaxChars,length);
    if(!text)return null;
    return {
      kind: "verified_card",
      confidence: cardCandidate.confidence,
      answerLength: length,
      intent,
      text,
      evidenceIds: [...new Set(cardCandidate.card.evidenceIds.map(String))],
      source: "verified_interview_card",
    };
  }

  const citationCandidate = selectExplicitCitation(citations, question, intent);
  if (!citationCandidate || citationCandidate.confidence < HIGH_CONFIDENCE_THRESHOLD) return null;
  const citationText = compactCitation(citationCandidate.citation, profile.cardMaxChars, intent);
  const text = formatImmediateCard(citationText, [], intent, profile.cardMaxChars, length);
  if (!text) return null;
  return {
    kind: "verified_card",
    confidence: citationCandidate.confidence,
    answerLength: length,
    intent,
    text,
    evidenceIds: [String(citationCandidate.citation.evidenceId)],
    source: "fast_retrieval_citation",
  };
}

export function buildVerifiedPersonalResponse({question,retrieval,answerLength='standard'}={}) {
  if(splitQuestionParts(question).length>1)return null;
  const asksCapability=isSkillExperienceQuestion(question);
  if(asksCapability){
    const exact=selectCuratedPersonalAnswer(normalizeCitations(retrieval?.citations),question,classifyFrequentInterviewQuestion(question));
    if(!exact?.exact)return null;
  }
  if(retrieval?.conversationContext?.personalBackground){
    const candidate=selectCuratedPersonalAnswer(normalizeCitations(retrieval?.citations),question,classifyFrequentInterviewQuestion(question));
    if(!candidate?.exact)return {text:'这部分个人动机和转折经历还没有补充，暂时不能替你编一个故事。需要先记录真实原因、具体事件和当时的选择，再整理成口述回答。',evidenceIds:[],source:'personal_background_unconfirmed'};
  }
  if(asksPersonalContribution(question)&&retrieval?.conversationContext?.projects?.length){
    const trusted=trustedCuratedCitations([...(retrieval.cardCatalog??[]),...(retrieval.citations??[])].filter(c=>c&&c.evidenceId&&normalizeText(c.snippet)));
    const sections=[],evidenceIds=[];
    const scopes=retrieval.conversationContext.projects;
    const contributionProjects=[...new Set(scopes)];
    for(const project of contributionProjects){
      const scoped=trusted.filter(c=>c.curatedAnswer.project===project);
      const twoExamples=/两(?:个|件|项)/.test(question)?scoped.find(c=>/两(?:个|件|项)/.test(c.curatedAnswer.question)&&/(?:亲手|动手|贡献|职责)/.test(c.curatedAnswer.question)):null;
      const ownership=twoExamples??scoped.find(c=>/(?:个人贡献|个人.*负责|你.{0,20}(?:负责|做了什么)|你到底|你在其中|第三作者|作者.*贡献)/.test(c.curatedAnswer.question))??scoped.find(c=>/口语讲解/.test(`${c.title??''} ${c.documentName??''}`)&&/(?:承担|贡献|负责)/.test(c.curatedAnswer.question));
      const prefix=contributionProjects.length>1?`${PROJECT_NAMES[project]||project}：`:'';
      sections.push(prefix+(ownership?spokenAnswer(ownership.curatedAnswer,answerLength):'这部分具体分工还需要核对，我先不把团队的实现当成我个人完成的工作。'));
      if(ownership)evidenceIds.push(String(ownership.evidenceId));
    }
    return {text:sections.join('\n\n'),evidenceIds,source:'verified_contribution_boundary'};
  }
  const candidate=selectCuratedPersonalAnswer(normalizeCitations(retrieval?.citations),question,classifyFrequentInterviewQuestion(question));
  if(!candidate?.exact)return null;
  const card=candidate.citation.curatedAnswer;
  if(card.spokenAnswers)return {text:spokenAnswer(card,answerLength),evidenceIds:[String(candidate.citation.evidenceId)],source:'verified_personal_knowledge_card'};
  const boundary=card.contributionStatus==='technical_only'||card.contributionStatus==='pending'
    ? '贡献边界：本条是技术资料，不能据此认定个人实现归属。' : '';
  return {text:[card.answer,boundary,...(card.uncertainties??[]).map(t=>'待确认：'+t)].filter(Boolean).join('\n'),evidenceIds:[String(candidate.citation.evidenceId)],source:'verified_personal_knowledge_card'};
}

export function trustedCuratedCitations(citations){
  return citations.filter(c=>{
    const a=c.curatedAnswer;
    return c.sourceType==="personal-card"&&a?.version===1&&a.directAnswer===true
      &&a.origin==="codex_curated_with_sources"&&a.evidenceVerified===true
      &&a.revision&&a.revision===c.personalRevision&&["ready","confirmed"].includes(a.status)
      &&(a.kind!=="personal"||a.status==="confirmed")&&normalizeText(a.answer).length>=20
      &&normalizeText(a.question)&&cardAnswerTexts(a).every(text=>!UNSAFE_CITATION_LINE.test(text))
      &&(!cardAnswerTexts(a).some(hasPersonalClaim)||a.contributionStatus==='resume_stated'||a.kind==='personal'&&a.status==='confirmed');
  });
}
function selectCuratedPersonalAnswer(citations,question,intent){
  const trusted=trustedCuratedCitations(citations);
  const projects=[...new Set(trusted.map(c=>normalizeText(c.curatedAnswer.project).toLowerCase()).filter(Boolean))];
  const lowered=normalizeText(question).toLowerCase();
  const named=projects.filter(project=>project.length>=3&&lowered.includes(project));
  const identifiers=extractProjectIdentifiers(question);
  const candidates=trusted.flatMap(citation=>{
    const a=citation.curatedAnswer,project=normalizeText(a.project).toLowerCase();
    if(named.length&&!named.includes(project))return [];
    const haystack=normalizeText([a.project,a.title,a.question,...(a.aliases??[]),a.answer].join(" ")).toLowerCase();
    if(identifiers.some(id=>!haystack.includes(id.toLowerCase())))return [];
    const alternatives=[a.question,...(a.aliases??[])];
    const queryTerms=specificQuestionTerms(question,project);
    const exact=alternatives.some(value=>comparableQuestion(value)===comparableQuestion(question));
    let relevance=0,matched=0;
    for(const alternative of alternatives){
      const terms=specificQuestionTerms(alternative,project);
      const count=[...queryTerms].filter(term=>terms.has(term)).length;
      const coverage=count/Math.max(1,queryTerms.size);
      if(coverage>relevance){relevance=coverage;matched=count;}
    }
    const overview=intent==="project_intro"&&named.includes(project)
      &&/(?:项目.{0,6}(?:介绍|定位|概览)|(?:介绍|概述).{0,12}项目|一分钟.{0,12}(?:介绍|讲清)|HR.{0,12}(?:讲述|叙述))/iu.test(`${a.title} ${a.question}`);
    if(!overview&&(queryTerms.size<2||matched<2||relevance<0.65))return [];
    const confidence=clampConfidence(exact?0.98:overview&&queryTerms.size<2?0.86:0.82+Math.min(0.14,relevance*0.14));
    return [{citation,confidence,relevance,exact}];
  }).sort((a,b)=>b.confidence-a.confidence||b.relevance-a.relevance);
  const distinct=candidates.filter((item,index)=>candidates.findIndex(other=>other.citation.curatedAnswer.revision===item.citation.curatedAnswer.revision)===index);
  if(!distinct.length)return null;
  // Shared generic wording is not enough to choose between two different answers.
  if(distinct[1]&&(!distinct[0].exact||distinct[1].exact)&&distinct[0].relevance-distinct[1].relevance<0.15)return null;
  return distinct[0];
}

function comparableQuestion(value){
  return normalizeText(value).toLowerCase().replace(/^(?:请问|请|能否|能不能)/u,"").replace(/[\s\p{P}]/gu,"");
}

function specificQuestionTerms(value,project){
  let normalized=normalizeText(value).toLowerCase();
  if(project)normalized=normalized.split(project).join(" ");
  normalized=normalized.replace(/(?:请问|请|你们|这个|一下|项目|怎么|如何|什么|为什么|介绍|讲讲|说说|有没有|可以|具体|是否|实现|设计|原理|技术|你的|你|它|吗|呢|的|了)/gu," ");
  return tokenize(normalized);
}

const BOUNDARY_SENTENCE=/(?:不能|不代表|不证明|不意味着|不可|不应|不是|不支持|不等于|并不|尚未|未(?:确认|提供|执行|验证|证明)|待确认|待核对|仍待|(?:需要|必须).{0,14}(?:确认|核对|补充)|个人.{0,10}(?:边界|分工|贡献|职责)|具体.{0,8}分工|简历.{0,8}(?:自述|所述)|团队.{0,8}(?:结果|指标)|(?:项目|论文|系统)整体.{0,6}(?:结果|指标|规模)|仅限|只能)/u;

function completeSentences(value){
  // A period inside 71.1%, Node.js, v4.10 or a file path is never a boundary.
  return String(value??"").replace(/\s+/gu," ").trim().split(/(?<=[。！？!?])\s*|(?<=[^\d]\.)(?=\s|$)\s*/u).filter(Boolean);
}

function formatCuratedPersonalAnswer(card,limit,answerLength){
  if(card.spokenAnswers)return spokenAnswer(card,answerLength);
  const sentences=completeSentences(card.answer);
  if(!sentences.length)return "";
  const selected=new Set([0,...sentences.flatMap((s,i)=>BOUNDARY_SENTENCE.test(s)?[i]:[])]);
  const attribution=card.kind==="personal"?"归属：已确认的个人经历。":"归属：技术资料，不作为个人贡献证明。";
  const render=()=>[...selected].sort((a,b)=>a-b).map((i,n)=>`${n===0?"结论":"要点"}：${sentences[i]}`).concat(attribution).join("\n");
  // Never cut an essential qualification to meet a cosmetic length budget.
  if(render().length>limit)return "";
  for(let i=1;i<sentences.length;i++){
    if(selected.has(i))continue;
    if(selected.size>=(answerLength==="quick"?2:5))break;
    selected.add(i);if(render().length>limit)selected.delete(i);
  }
  return render();
}

function selectVerifiedCard(cards, question, intent, citations) {
  const candidates = (Array.isArray(cards) ? cards : [])
    .filter((card) => card?.verification?.status === "verified"
      && normalizeText(card.answer)
      && Array.isArray(card.evidenceIds)
      && card.evidenceIds.length > 0)
    .map((card) => {
      const cardIntent = classifyFrequentInterviewQuestion(`${card.question ?? ""} ${(card.keywords ?? []).join(" ")}`);
      const intentMatches = intentsAreCompatible(intent, cardIntent);
      const overlap = lexicalOverlap(question, `${card.question ?? ""} ${(card.keywords ?? []).join(" ")}`);
      const evidence = new Set(card.evidenceIds.map(String));
      const requiredProjectIds = intent === "project_intro" ? extractProjectIdentifiers(question) : [];
      const cardText = normalizeText(`${card.question ?? ""} ${(card.keywords ?? []).join(" ")} ${card.answer ?? ""}`).toLowerCase();
      const projectIdMatches = !requiredProjectIds.length
        || requiredProjectIds.every((identifier) => cardText.includes(identifier.toLowerCase()));
      const citationEvidenceMatch = citations.some((citation) => evidence.has(String(citation.evidenceId)));
      const citationIntentMatch = citations.some((citation) => intentsAreCompatible(
        intent,
        classifyFrequentInterviewQuestion(`${citation.title ?? ""} ${citation.documentName ?? ""} ${citation.snippet ?? ""}`),
      ));
      let confidence = 0.62;
      if (intentMatches) confidence += 0.16;
      confidence += Math.min(0.08, overlap * 0.12);
      if (citationEvidenceMatch) confidence += 0.09;
      else if (citationIntentMatch) confidence += 0.04;
      if (card.verification?.auditedAt || normalizeText(card.verification?.reason)) confidence += 0.02;
      if (!intentMatches || overlap < 0.1 || !projectIdMatches) confidence = Math.min(confidence, 0.81);
      return { card, confidence: clampConfidence(confidence), overlap, citationEvidenceMatch };
    })
    .sort((left, right) => right.confidence - left.confidence
      || Number(right.citationEvidenceMatch) - Number(left.citationEvidenceMatch)
      || right.overlap - left.overlap);
  return candidates[0] ?? null;
}

function selectExplicitCitation(citations, question, intent) {
  const requiredProjectIds = intent === "project_intro" ? extractProjectIdentifiers(question) : [];
  return citations
    .filter(isCuratedAnswerCitation)
    .filter(isDirectAnswerCitation)
    .map((citation, index) => {
      const title = `${citation.title ?? ""} ${citation.documentName ?? ""} ${citation.sourcePath ?? ""}`;
      const body = citation.snippet ?? "";
      const titleIntent = classifyFrequentInterviewQuestion(title);
      const bodyIntent = classifyFrequentInterviewQuestion(body);
      const explicitTitle = intentsAreCompatible(intent, titleIntent);
      const explicitBody = intentsAreCompatible(intent, bodyIntent);
      const overlap = lexicalOverlap(question, `${title} ${body}`);
      const citationText = normalizeText(`${title} ${body}`).toLowerCase();
      const projectIdMatches = !requiredProjectIds.length
        || requiredProjectIds.every((identifier) => citationText.includes(identifier.toLowerCase()));
      let confidence = explicitTitle ? 0.72 : explicitBody ? 0.66 : 0.48;
      if (explicitBody) confidence += 0.06;
      confidence += Math.min(0.07, overlap * 0.1);
      if (Number(citation.score) > 0) confidence += Math.min(0.05, Math.log1p(Number(citation.score)) / 40);
      if (citation.evidenceId) confidence += 0.03;
      confidence += Math.max(0, 0.02 - index * 0.005);
      if (!explicitTitle && !explicitBody) confidence = Math.min(confidence, 0.78);
      if (overlap < 0.1 || !projectIdMatches) confidence = Math.min(confidence, 0.81);
      return { citation, confidence: clampConfidence(confidence), overlap };
    })
    .sort((left, right) => right.confidence - left.confidence || right.overlap - left.overlap)[0] ?? null;
}

function normalizeCitations(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, TOP_CITATION_LIMIT)
    .filter((citation) => citation && citation.evidenceId && normalizeText(citation.snippet));
}

function intentsAreCompatible(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left === "strengths_weaknesses") return right === "strengths" || right === "weaknesses";
  if (right === "strengths_weaknesses") return left === "strengths" || left === "weaknesses";
  return false;
}

function compactCitation(citation, limit, intent) {
  const title = normalizeText(citation.title);
  const lines = String(citation.snippet ?? "")
    .split(/\r?\n/u)
    .map((raw) => ({
      raw,
      heading: /^\s*#{1,6}\s+/u.test(raw),
      text: raw.replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/u, "").trim(),
    }))
    .filter((line) => line.text && !UNSAFE_CITATION_LINE.test(line.text))
    .filter((line) => normalizeText(line.text) !== title)
    .filter((line, index) => !(index === 0
      && intentsAreCompatible(intent, classifyFrequentInterviewQuestion(line.text))
      && (line.heading || /(?:[？?]$|^(?:请|如何|为什么|介绍|讲讲|说说))/u.test(line.text))));
  return compactAnswer(lines.map((line) => line.text).join(" "), limit);
}

function isCuratedAnswerCitation(citation) {
  // Personal-library cards require the explicit verified metadata path above;
  // a title or attribution-only chunk can never stand in for its answer.
  if(citation.sourceType==="personal-card")return false;
  // documentName is often the name of the entire folder (for example
  // "...面试知识库"), so using it would incorrectly mark every chunk as a
  // direct-answer card. Restrict trust promotion to the section title/path.
  return /(?:问答卡|答案卡|行为题|面试|高频题|自我介绍|项目介绍|优缺点|star|interview|faq|answer[-_ ]?card)/iu.test([
    citation.title,
    citation.sourcePath,
  ].filter(Boolean).join(" "));
}

function isDirectAnswerCitation(citation) {
  const bodyLines = String(citation.snippet ?? "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/u, "").trim())
    .filter(Boolean)
    .slice(1);
  if (!bodyLines.length) return false;
  const substantive = bodyLines.filter((line) => !/^(?:关键词别名|用途|证据\s*ID|类型)[:：]/iu.test(line));
  return substantive.join(" ").length >= 20;
}

function formatImmediateCard(value, suppliedKeywords, intent, limit, answerLength) {
  const answer = normalizeText(value);
  if (!answer) return "";
  const keywords = collectKeywords(suppliedKeywords, answer, intent).slice(0, 3);
  // Keep decimal/version dots (3.805/4.10, Node.js) inside one spoken clause.
  // Chinese answer cards already use full-width sentence punctuation, so a
  // dot-free boundary is both safer and more natural here.
  const clauses = completeSentences(answer)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const required=new Set([0,...clauses.flatMap((clause,index)=>BOUNDARY_SENTENCE.test(clause)?[index]:[])]);
  const lines = [...required].sort((a,b)=>a-b).map((index,n)=>({label:n===0?"结论：":"要点：",value:clauses[index]??answer}));
  if (answerLength !== "quick") {
    for (let index=1;index<clauses.length&&lines.length<4;index++)if(!required.has(index))lines.push({ label: "要点：", value: clauses[index] });
  }
  let keywordIndex = 0;
  while (lines.length < 4 && keywordIndex < keywords.length) {
    lines.push({ label: "关键词：", value: keywords[keywordIndex++] });
  }
  while (lines.length < 4) lines.push({ label: "关键词：", value: (collectKeywords([], answer, intent)[lines.length - 1] ?? "事实边界") });
  if (answerLength === "quick") {
    while (lines.length < 4 && keywordIndex < keywords.length) {
      lines.push({ label: "关键词：", value: keywords[keywordIndex++] });
    }
  }
  return lines.length<=6?fitLogicalLines(lines, limit):"";
}

function fitLogicalLines(lines, limit) {
  const rendered=lines.map(line=>`${line.label}${line.value}`).join("\n");
  return rendered.length<=limit?rendered:"";
}

function extractProjectIdentifiers(value) {
  const text = normalizeText(value);
  const identifiers = [];
  for (const match of text.matchAll(/[“"「『]([^”"」』]{2,32})[”"」』]/gu)) identifiers.push(match[1]);
  const genericEnglish = new Set(["project", "projects", "recent", "latest", "introduce", "experience", "your", "about"]);
  for (const token of text.match(/[A-Za-z][A-Za-z0-9_.-]{2,31}/gu) ?? []) {
    if (!genericEnglish.has(token.toLowerCase())) identifiers.push(token);
  }
  return [...new Set(identifiers.map(normalizeText).filter(Boolean))].slice(0, 3);
}

function collectKeywords(supplied, answer, intent) {
  const defaults = {
    self_intro: ["经历", "项目", "能力边界"],
    project_intro: ["项目目标", "个人贡献", "量化结果"],
    strengths: ["核心优势", "事实证据", "适用场景"],
    weaknesses: ["真实不足", "改进动作", "当前结果"],
    strengths_weaknesses: ["核心优势", "真实不足", "改进动作"],
    experience_intro: ["经历背景", "个人行动", "结果复盘"],
  };
  const candidates = [
    ...(Array.isArray(supplied) ? supplied : []),
    ...(String(answer).match(/[A-Za-z][A-Za-z0-9+.#_-]{1,24}/gu) ?? []),
    ...(defaults[intent] ?? ["事实", "行动", "结果"]),
  ];
  const result = [];
  for (const candidate of candidates) {
    const clean = normalizeText(candidate).replace(/^[,，、;；:：]+|[,，、;；:：]+$/gu, "").slice(0, 24);
    if (!clean || result.some((item) => item.toLowerCase() === clean.toLowerCase())) continue;
    result.push(clean);
    if (result.length >= 3) break;
  }
  return result;
}

function compactAnswer(value, limit) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= limit) return text;
  const sentences = completeSentences(text);
  if(sentences.some(sentence=>BOUNDARY_SENTENCE.test(sentence))&&text.length>limit)return "";
  let result = "";
  for (const sentence of sentences) {
    const next = `${result}${sentence}`.trim();
    if (next.length > limit) break;
    result = next;
  }
  return result;
}

function lexicalOverlap(left, right) {
  const leftTerms = tokenize(left);
  const rightTerms = tokenize(right);
  if (!leftTerms.size || !rightTerms.size) return 0;
  let matches = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) matches += 1;
  return matches / Math.max(1, Math.min(leftTerms.size, 10));
}

function tokenize(value) {
  const normalized = normalizeText(value).toLowerCase();
  const terms = new Set(normalized.match(/[a-z0-9_+.#-]{2,}/gu) ?? []);
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return terms;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function clampConfidence(value) {
  return Number(Math.max(0, Math.min(0.99, value)).toFixed(3));
}

export const VERIFIED_ANSWER_CARD_THRESHOLD = HIGH_CONFIDENCE_THRESHOLD;

export const SPOKEN_MODES = Object.freeze(['quick', 'standard', 'deep']);
const limits = {quick:500, standard:1000, deep:5000};

// These are reviewed alternatives from the same evidence card, never model
// completions or arbitrary character slices of a longer qualified claim.
export function validateSpokenAnswers(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !SPOKEN_MODES.includes(key))) throw Error('口述答案格式不正确。');
  const result = {};
  for (const mode of SPOKEN_MODES) {
    if (typeof value[mode] !== 'string' || !value[mode].trim() || value[mode].length > limits[mode]) throw Error(`口述答案 ${mode} 为空或过长。`);
    result[mode] = value[mode].trim();
  }
  return result;
}

export function spokenAnswer(card, mode='standard') {
  const key = SPOKEN_MODES.includes(mode) ? mode : 'standard';
  return card.spokenAnswers?.[key] || card.answer || card.summary || '';
}

export function hasPersonalClaim(text) {
  for(const sentence of String(text??'').split(/[。！？；\n]/u)){
    const claims=sentence.matchAll(/(?:本人|我)(?:们)?(?<between>[^。！？；\n]{0,40}?)(?:负责|主导|实现|设计|开发|完成|参与|承担|担任|是.{0,16}(?:作者|负责人|实习生|工程师))/gu);
    for(const match of claims){
      const before=sentence.slice(Math.max(0,match.index-28),match.index),between=match.groups?.between??'';
      if(/不能|不可|不应|不代表|是否|若面试问|无法|尚未|未能|没有|不是|待(?:核对|确认)|需(?:要)?(?:核对|确认)|如果|假如|假设/.test(before))continue;
      const after=sentence.slice(match.index+match[0].length);
      if(/^(?:哪|什么|多少|是否)/.test(after)||/是否|多少/.test(between))continue;
      if(/^(?:会|将|要)/.test(between)||/不(?:是|能|会|曾)|未|没有|(?:认为|理解|建议|计划|希望|打算|应该|可以|需要|会先|将会)/.test(between))continue;
      return true;
    }
  }
  return false;
}

export function cardAnswerTexts(card) {
  return [card.answer??card.summary,...Object.values(card.spokenAnswers??{})].filter(v=>typeof v==='string');
}

export const PROJECT_NAMES = Object.freeze({profile:'个人资料'});

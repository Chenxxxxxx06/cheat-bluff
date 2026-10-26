// Split independent questions before any shortcut can answer only one part.
export function splitQuestionParts(question) {
 const text=String(question??'').trim();
 const parts=text.split(/(?<=[？?；;])\s*|[，,]\s*(?=(?:另外|以及|同时|还有)(?:我|你|它|这|是否|能|会|为什么|怎么|如何))/u).map(s=>s.trim()).filter(Boolean);
 // Style requests belong to the preceding question, not a separate fact request.
 const result=[];for(const part of parts){if(result.length&&/^(?:没有.{0,12}证据|别编|不要编|能(?:不能)?(?:讲|说|解释).{0,15}(?:好懂|简单|口语|通俗)|(?:请)?(?:再|更)(?:口语|简单|通俗))/.test(part)){result[result.length-1]+=' '+part;continue;}if(result.length&&/^(?:请|用|简单|简短|口语|给我).{0,25}(?:解释|说明|回答|介绍|例子|句话|口语)/.test(part)&&!/[吗么]|为什么|是否/.test(part))result[result.length-1]+=' '+part;else result.push(part);}
 return result.length?result:[text];
}

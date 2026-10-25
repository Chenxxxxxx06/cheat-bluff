import {classifyInterviewQuestion} from '../prompts/realtime.mjs';
// Project aliases resolve references only; they never assert candidate ownership.
const aliases = {};
const norm = value => String(value ?? '').toLowerCase().replace(/[\s_-]+/g,'');
export const asksPersonalContribution = question => /(?:个人贡献|个人调|亲自|本人|谁写|(?:你|我|自己|个人|作者).{0,12}(?:独立|分工)|[你我].{0,35}(?:写了|写过|写的|负责|做了|做过|承担|设计|完成|贡献|动.{0,4}手)|自己.{0,20}(?:写|负责|做|承担|动.{0,4}手)|一个人.{0,10}(?:写|做|设计|完成))/.test(question);
const profileQuestion = question => /(?:简历|项目|经历|负责|贡献|实习|自我介绍|这些系统|奖项|求职|应聘|[你我].{0,12}(?:做|动手|承担))/.test(question)||asksPersonalContribution(question);
const backgroundQuestion = question => /(?:职业规划|个人动机|求职动机|亲身经历|转折故事|博士.{0,8}(?:规划|申请|动机)|博士研究方向.{0,12}(?:为什么|选|计划)|(?:为什么|为何|原因|决定|选择|动机|想法).{0,12}(?:读博|读研|深造|选择这个岗位)|(?:读博|读研).{0,12}(?:原因|动机|想法|选择|决定))/.test(question);
// Enrollment is a source-backed resume fact; it must not use the unknown-motivation fallback.
const educationFactQuestion = question => !/(?:字段|SQL|数据库|(?:提取|抽取|解析|识别).{0,15}(?:学历|教育背景|入学|毕业|学校)|(?:学历|教育背景|入学时间|毕业时间).{0,8}(?:列|值|缺失|为空))/i.test(question)
  && /(?:[你我].{0,12}(?:在读|就读|保研)|(?:目前|现在|已经|是否|是不是|还在).{0,16}(?:读博|读研|博士在读|在读博士|本科生|入学|就读)|(?:什么时候|哪年).{0,8}(?:入学|毕业|读博|读研)|(?:哪所|哪个).{0,6}(?:学校|大学)|(?:读博|读研|入学)(?:了)?[吗么？?]|学历|教育背景|入学时间|毕业时间|保研去向)/.test(question);
export function resolveConversationContext(question, interview, projects = []) {
  const catalog = [...new Set(projects)].filter(p=>p && p!=='profile');
  const mentions = text => catalog.filter(p=>[p,...(aliases[p]??[])].some(a=>norm(text).includes(norm(a))));
  const explicit = mentions(question);
  const prior = (interview?.answers??[]).filter(m=>m.role==='user'&&m.content).slice(-10);
  const personalBackground = backgroundQuestion(question);
  const personalEducation = educationFactQuestion(question) && (!explicit.length || /(?:[你我].{0,18}(?:在读|就读|入学|毕业|保研|读博|读研)|(?:你的|我的).{0,6}(?:学历|教育背景|学校))/.test(question));
  const standalone = personalBackground || personalEducation || /(?:LeetCode|八股|TCP|UDP|两数之和|二叉树|链表|动态规划|操作系统|换个话题|换一道)/i.test(question);
  const referential = /(?:刚才|上面|前面|它|这个|那个|这条|那条|那加|那倒|那遇|假如|这些|分别|相比|比较|区别|跟.+比)/.test(question) || /^那/.test(question);
  let inherited=[], anchor='';
  if (!standalone && (explicit.length===0 || (explicit.length===1 && /(?:刚才|上面|前面|它|这个|那个|跟它|和它|^和.+比)/.test(question)))) {
    for(let i=prior.length-1;i>=0;i--){
      const found=mentions(prior[i].content);
      if(found.length){inherited=found;anchor=String(prior[i].content).slice(0,280);break;}
      if(projects.includes('profile')&&profileQuestion(prior[i].content)){inherited=['profile'];anchor=String(prior[i].content).slice(0,280);break;}
    }
  }
  const selected = personalBackground || personalEducation ? (projects.includes('profile')?['profile']:[]) : explicit.length && !referential ? explicit : [...new Set([...explicit,...inherited])];
  if(!selected.length&&!standalone&&projects.includes('profile')&&profileQuestion(question))selected.push('profile');
  let questionType=classifyInterviewQuestion(question);
  if(!selected.length&&!standalone&&questionType==='technical'&&referential&&classifyInterviewQuestion(prior.at(-1)?.content)==='algorithm')questionType='algorithm';
  // Unresolved scope must never receive a candidate identity for unconstrained
  // first-person generation. Generic teaching is safe; invented biography is not.
  const generalKnowledge=!selected.length&&(projects.length>0||questionType==='algorithm'||/(?:八股|TCP|UDP|操作系统|三次握手)/i.test(question));
  return {projects:selected,anchor:!explicit.length?anchor:'',questionType,generalKnowledge,personalBackground,
    query:selected.length?`${selected.join(' ')} ${question}${!explicit.length&&anchor?`\n前问：${anchor}`:''}`:question,
    note:selected.length?`本轮知识主题：${selected.join('、')}。${!explicit.length&&anchor?`相关前问：${anchor}`:''}只用于理解问题，不证明事实或个人贡献。`:''};
}

export function mergeProjectRetrieval(results, projectIds, limit=12) {
  const lists=results.map((r,i)=>{
    const documents=new Map();
    for(const c of r?.citations??[]){
      if(projectIds[i]&&c.curatedAnswer?.project!==projectIds[i]&&!String(c.documentName??'').toLowerCase().startsWith(projectIds[i].toLowerCase()+' ·'))continue;
      const previous=documents.get(c.documentId);
      if(!previous||(!previous.curatedAnswer&&c.curatedAnswer))documents.set(c.documentId,c);
    }
    return [...documents.values()];
  });
  const seen=new Set(),citations=[];
  for(let row=0;row<limit;row++)for(const list of lists){const c=list[row];if(!c||seen.has(c.documentId))continue;seen.add(c.documentId);citations.push(c);if(citations.length===limit)return {...results[0],citations};}
  return {...results[0],citations};
}

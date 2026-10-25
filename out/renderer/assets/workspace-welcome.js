// Original Cheat Bluff empty conversation · undestand.
export function createWorkspaceWelcome({React,useMaterials}){
 const h=React.createElement;
 return function Welcome({workspaceId,onDraft,onOpenMaterials}){
  const {data,isLoading}=useMaterials(workspaceId),materials=data?.hydrated;
  const job=materials?.jobDescription,resume=materials?.resume;
  const fill=text=>{onDraft(text);requestAnimationFrame(()=>document.querySelector('[data-aether-prompt-input] textarea')?.focus());};
  return h('section',{className:'cb-workspace-welcome','aria-label':'面试准备步骤'},
   h('img',{src:new URL('./cheat-bluff-icon.png',import.meta.url).href,alt:'',width:44,height:44}),
   h('h2',null,job?'开始准备这次面试':'这次面试，先准备什么？'),
   h('p',{className:'cb-welcome-summary'},isLoading?'正在读取本次资料…':job?`${job.title||'岗位要求已保存'}${resume?' · 简历已关联':''}`:resume?'简历已关联，补充岗位要求就可以开始。':'告诉我公司、岗位和面试时间，我会帮你整理准备重点。'),
   h('ol',null,
    h('li',null,h('span',null,'1'),h('div',null,h('strong',null,'补充岗位'),h('p',null,'粘贴 JD，或说说公司与岗位。'))),
    h('li',null,h('span',null,'2'),h('div',null,h('strong',null,'选择资料'),h('p',null,'查看本次简历、项目和知识库。'))),
    h('li',null,h('span',null,'3'),h('div',null,h('strong',null,'开始准备'),h('p',null,'梳理重点、练习问答，再开始面试。')))),
   h('div',{className:'cb-welcome-actions'},h('button',{onClick:()=>fill('我准备面试：\n公司：\n岗位：\n时间：\n岗位要求：')},'填写面试信息'),h('button',{onClick:onOpenMaterials},'查看本次资料'),h('button',{onClick:()=>fill('请根据本次岗位要求和我的项目资料，列出最需要准备的 3 个问题。回答简短、口语化。')},'帮我梳理重点')));
 };
}

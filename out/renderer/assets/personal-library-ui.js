export const projectLabels={profile:'个人资料与 HR'};
export const projectFamily = key => key;
export const matchesProject = (card,key) => key==='all'||(card.project||'other')===key;
export function createPersonalLibraryView({React, Header, Button,Modal="div",Select="select"}) {
  const h=React.createElement;
  const invoke=(action,input={})=>window.api.personalLibrary.invoke(action,input);
  const labels={ready:"可用知识",confirmed:"已确认",needs_confirmation:"待确认经历",rejected:"未采用",stale:"来源已更新"};
  const relations={mixed:"混合材料，归属待核对",mine:"我的项目 / 论文 / 经历",reference:"阅读资料 / 开源参考"};
  const jobLabels={queued:"等待中",running:"处理中",paused:"已暂停",completed:"已完成",failed:"需要重试",cancelled:"已取消"};
  const projectNames=projectLabels;
  function btn(label,onClick,disabled=false,extra={}){return h(Button,{size:"sm",variant:"outline",onClick,disabled,...extra},label);}
  function field(label,value,onChange,{area=false,placeholder="",maxLength=2400}={}){return h("label",{className:"pl-field"},h("span",null,label),h(area?"textarea":"input",{value,onChange:e=>onChange(e.target.value),placeholder,maxLength,rows:area?4:undefined}));}
  function KnowledgeCard({card,source,busy,onReview,onSource}) {
    const [editing,setEditing]=React.useState(false),[summary,setSummary]=React.useState(card.summary),[owned,setOwned]=React.useState(false);
    const [speech,setSpeech]=React.useState('standard');
    const personal=card.kind==="personal";
    return h("article",{className:"pl-card",'data-card-id':card.id},
      h("div",{className:"pl-row"},h("h3",null,card.title),h("span",{className:`pl-badge pl-${card.status}`},labels[card.status])),
      card.spokenAnswers?h(React.Fragment,null,h('div',{className:'pl-speech-tabs','aria-label':'口述答案长度'},[['quick','速答'],['standard','标准'],['deep','深挖']].map(([value,label])=>h('button',{key:value,type:'button','aria-pressed':speech===value,onClick:()=>setSpeech(value)},label))),h('p',{className:'pl-content pl-speech-answer'},card.spokenAnswers[speech]),h('details',null,h('summary',null,'完整事实与边界'),h('p',{className:'pl-content'},card.summary))):h("p",{className:"pl-content"},card.summary),
      card.tags.length>0&&h("p",{className:"pl-muted"},card.tags.join(" · ")),
      card.question&&h("p",{className:"pl-question"},"可以准备：",card.question),
      card.uncertainties?.length>0&&h('details',null,h('summary',null,`待核对与适用条件 · ${card.uncertainties.length} 项`),card.uncertainties.map((item,i)=>h('p',{key:i,className:'pl-muted'},item))),
      card.followUps?.length>0&&h("details",null,h("summary",null,"可能的追问"),card.followUps.map((q,i)=>h("p",{key:i},q))),
      card.evidence?.length>0&&h("details",null,h("summary",null,`${card.evidence.length} 条原始证据`),card.evidence.map((e,i)=>h("div",{key:i},h("p",{className:"pl-muted"},`${e.sourcePath} · 原文件 L${e.originalStartLine??e.startLine}–L${e.originalEndLine??e.endLine}`),h("blockquote",null,e.quote),btn("查看证据原文",()=>onSource(e.sourceId))))),
      h("details",null,h("summary",null,`${source?.name||"来源材料"} · 第 ${card.lineStart}–${card.lineEnd} 行`),h("blockquote",null,card.quote),btn("查看原文",()=>onSource(card.sourceId))),
      card.status==="stale"?h("p",{className:"pl-muted"},"来源已变化，此卡已停止参与回答。重新整理材料可生成新卡。"):
      h(React.Fragment,null,
        h("div",{className:"pl-actions"},btn(editing?"收起编辑":personal?"核对个人经历":"编辑知识卡",()=>setEditing(!editing),busy),card.status!=="rejected"&&btn("不采用",()=>void onReview(card,{status:"rejected"}).catch(()=>{}),busy)),
        editing&&h("div",{className:"pl-edit"},field("调整后保存的内容",summary,setSummary,{area:true,maxLength:card.origin==="codex_curated_with_sources"?5000:900}),
          personal&&h("label",{className:"pl-check"},h("input",{type:"checkbox",checked:owned,onChange:e=>setOwned(e.target.checked)}),"我确认这段内容描述的是我本人的经历或贡献"),
          btn(personal?"确认个人经历":"保存并采用",async()=>{try{await onReview(card,{status:"confirmed",summary,confirmOwnership:owned});setEditing(false);}catch{}},busy||!summary.trim()||(personal&&!owned),{variant:"default"})))
    );
  }
  return function PersonalLibrary({onLegacy}) {
    const [data,setData]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(""),[notice,setNotice]=React.useState("");
    const [tab,setTab]=React.useState("projects"),[profileEdit,setProfileEdit]=React.useState(null),[material,setMaterial]=React.useState(null),[sourceView,setSourceView]=React.useState(null);
    const [project,setProject]=React.useState('all'),[preparationName,setPreparationName]=React.useState(null);
    const [relationship,setRelationship]=React.useState("mixed"),[query,setQuery]=React.useState(""),[status,setStatus]=React.useState("all"),[page,setPage]=React.useState(1),[searchResult,setSearchResult]=React.useState(null);
    React.useEffect(()=>{const listener=e=>{if(['projects','cards','materials','profile','feedback'].includes(e.detail))setTab(e.detail);};window.addEventListener('cheater-library-tab',listener);return()=>window.removeEventListener('cheater-library-tab',listener);},[]);
    React.useEffect(()=>{window.dispatchEvent(new CustomEvent('cheater-library-tab-changed',{detail:tab}));},[tab]);
    const selected=React.useRef(undefined),alive=React.useRef(true);
    const packagePicker=React.useRef(null);
    const [feedbackDrafts,setFeedbackDrafts]=React.useState({});
    const load=React.useCallback(async(id=selected.current)=>{
      const result=await invoke("snapshot",id?{profileId:id}:{});
      if(!alive.current||(id&&selected.current&&id!==selected.current))return;
      selected.current=result.profile?.id;setData(result);
    },[]);
    React.useEffect(()=>{alive.current=true;load().catch(e=>setError(e.message));return()=>{alive.current=false;};},[load]);
    const active=data?.jobs.some(j=>["queued","running"].includes(j.status));
    React.useEffect(()=>{if(!active)return;const timer=setInterval(()=>load().catch(e=>setError(e.message)),1500);return()=>clearInterval(timer);},[active,load]);
    async function run(action,input={},message="") {
      setBusy(true);setError("");setNotice("");
      try{const result=await invoke(action,input);await load();if(message&&!result?.canceled)setNotice(message);return result;}
      catch(e){setError(e.message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,"")||"操作未完成，请重试。");throw e;}
      finally{setBusy(false);}
    }
    const act=(action,input={},message="")=>()=>void run(action,input,message).catch(()=>{});
    const p=data?.profile;
    const feedback=feedbackDrafts[p?.id]??{company:"",role:"",questions:"",notes:""};
    const setFeedback=next=>{if(p)setFeedbackDrafts(drafts=>({...drafts,[p.id]:next}));};
    const sources=data?.sources??[],cards=data?.cards??[];
    const projectKeys=[...new Set(cards.filter(c=>!['stale','rejected'].includes(c.status)).map(c=>c.project||'other'))];
    const projectFamilies=[...new Set(projectKeys.map(projectFamily))];
    const usable=cards.filter(c=>["ready","confirmed"].includes(c.status)).length;
    const pending=cards.filter(c=>c.status==="needs_confirmation").length;
    const unfinished=data?.jobs.some(j=>["queued","running","paused"].includes(j.status));
    const matched=cards.filter(c=>(status==="all"?c.status!=="stale"&&c.status!=="rejected":status==="usable"?["ready","confirmed"].includes(c.status):c.status===status)
      &&matchesProject(c,project)&&(!query.trim()||`${c.title} ${c.summary} ${c.question} ${(c.aliases??[]).join(" ")} ${c.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())));
    async function showSource(id){try{const s=await run("source",{profileId:p.id,sourceId:id});setSourceView(s);}catch{}}
    async function review(card,patch){await run("review-card",{profileId:p.id,cardId:card.id,...patch},"知识卡已更新，下次回答将使用当前版本。");}
    async function saveProfile(){try{const saved=await run("save-profile",profileEdit);selected.current=saved.id;await load(saved.id);setProfileEdit(null);setNotice("个人档案已保存。新建面试将使用这个档案。");}catch{}}
    function newProfile(){setProfileEdit({name:"",targetRole:"",background:"",confirmedExperience:""});}
    const header=h(Header,{title:"个人资料与知识库",end:btn("原有知识库",onLegacy)});
    if(!data)return h("div",{className:"relative size-full"},header,h("main",{className:"pl-main"},h("p",null,error||"正在读取个人资料…"),error&&btn("重试",()=>load().catch(e=>setError(e.message)))));
    return h("div",{className:"relative size-full"},header,h("main",{className:"pl-main"},
      !p&&h("div",{className:"pl-intro"},h("span",{className:"pl-eyebrow"},"你的材料，逐步变成可复用的知识"),h("h1",null,"让 AI 帮你整理，而不必从头准备"),h("p",{className:"pl-muted"},"保存原始材料，提炼有来源的要点；更新时只整理有变化的部分。")),
      h("div",{className:"pl-row pl-profile-picker"},h("label",null,"当前个人档案",h(Select,{value:p?.id??"",disabled:busy,onChange:async e=>{const id=e.target.value;selected.current=id;setProject("all");setQuery("");setStatus("all");setProfileEdit(null);setSourceView(null);setSearchResult(null);setPage(1);try{await run("activate",{profileId:id});}catch{}}},!p&&h("option",{value:""},"尚未创建"),data.profiles.map(v=>h("option",{value:v.id,key:v.id},v.name)))),btn("新建个人档案",newProfile,busy)),
      error&&h("p",{role:"alert",className:"pl-alert"},error),notice&&h("p",{role:"status",className:"pl-notice"},notice),
      (!p&&!profileEdit)&&h("section",{className:"pl-card pl-empty"},h("h2",null,"建立我的资料库"),h("p",null,"先填写称呼和目标岗位，再把简历、论文、代码、笔记交给 AI 整理。"),btn("创建个人档案",newProfile,false,{variant:"default"})),
      profileEdit&&h("section",{className:"pl-card"},h("h2",null,profileEdit.id?"编辑个人档案":"创建个人档案"),
        h("div",{className:"pl-grid"},field("姓名 / 档案名称",profileEdit.name,v=>setProfileEdit({...profileEdit,name:v}),{maxLength:80,placeholder:"例如：小陈 · 算法工程师"}),field("目标岗位 / 研究方向",profileEdit.targetRole,v=>setProfileEdit({...profileEdit,targetRole:v}),{maxLength:240,placeholder:"例如：计算机视觉、后端开发"})),
        field("我的背景",profileEdit.background,v=>setProfileEdit({...profileEdit,background:v}),{area:true,placeholder:"教育背景、主要技能和求职方向"}),
        field("我确认的经历与职责",profileEdit.confirmedExperience,v=>setProfileEdit({...profileEdit,confirmedExperience:v}),{area:true,maxLength:4000,placeholder:"说明哪些项目由你参与、具体负责什么；不确定的数字可暂时留空。"}),
        h("div",{className:"pl-actions"},btn("保存个人档案",saveProfile,busy||!profileEdit.name.trim(),{variant:"default"}),btn("取消",()=>setProfileEdit(null),busy))),
      p&&h(React.Fragment,null,
        h("section",{className:"pl-card pl-overview"},h("div",{className:"pl-row"},h("div",null,h("h2",null,p.name),h("p",{className:"pl-muted"},p.targetRole||"尚未填写目标岗位")),h("div",{className:"pl-actions"},btn("编辑档案",()=>setProfileEdit({...p}),busy),btn("用此资料准备面试",()=>setPreparationName(''),busy,{variant:"default"}))),
          h("div",{className:"pl-stats"},h("span",null,h("strong",null,sources.length)," 份材料"),h("span",null,h("strong",null,usable)," 张可用知识卡"),h("span",null,h("strong",null,pending)," 条经历待确认")),
          h("p",{className:"pl-muted"},"新建面试使用当前档案；已有面试保持原来的档案归属。")),
        h("nav",{className:"pl-tabs","aria-label":"知识库工作区"},[["projects","项目覆盖"],["cards","问答与口述"],["materials","材料管理"],["profile","个人档案"],["feedback","面试复盘"]].map(([value,label])=>h("button",{key:value,type:"button","aria-pressed":tab===value,onClick:()=>setTab(value)},label))),
        tab==='projects'&&h(React.Fragment,null,h('p',{className:'pl-muted pl-coverage-note'},'按项目查看问答、口述稿和原文。资料保存在本机，来源更新后需重新导入。'),
          !projectKeys.length&&h('section',{className:'pl-card pl-empty'},h('h2',null,'先加入一个项目'),h('p',null,'导入论文、代码或已有知识包，即可查看覆盖范围。'),btn('添加材料',()=>setTab('materials'))),
          h('div',{className:'pl-project-grid'},projectFamilies.map(key=>{
            const group=cards.filter(c=>matchesProject(c,key)&&!['stale','rejected'].includes(c.status));
            const ids=new Set(group.flatMap(c=>[c.sourceId,...(c.evidence??[]).map(e=>e.sourceId)]));
            const files=sources.filter(s=>ids.has(s.id));
            const kinds=new Set(files.map(s=>/\.(?:py|ts|tsx|js|mjs|yaml|sh)(?:@|$)/i.test(s.path||s.name)?'代码':/paper|论文|260[68]|1729/i.test(`${s.name} ${s.path}`)?'论文':'文档 / 简历'));
            const oral=group.filter(c=>c.spokenAnswers).length,usableGroup=group.filter(c=>['ready','confirmed'].includes(c.status)).length,notes=group.filter(c=>c.uncertainties?.length||c.contributionStatus==='pending').length;
            return h('button',{type:'button',className:'pl-project',key,onClick:()=>{setProject(key);setQuery('');setStatus('all');setPage(1);setSearchResult(null);setTab('cards');}},h('h3',null,projectNames[key]||key),h('p',{className:'pl-project-count'},`${usableGroup} 张可用卡 · ${files.length} 份来源 · ${oral} 张三档口述稿`),h('p',{className:'pl-muted'},group.slice(0,3).map(c=>c.question||c.title).join(' / ')),h('div',{className:'pl-project-sources'},[...kinds].map(k=>h('span',{key:k},k))),h('p',{className:'pl-muted'},notes?`${notes} 张卡含适用条件或待核对说明 · 查看 →`:'查看问答与原文 →'));
          }))),
        tab==="feedback"&&h(React.Fragment,null,
          h("section",{className:"pl-card"},h("h2",null,"记录实际问过的问题"),h("p",{className:"pl-muted"},"问题和补充说明会长期保存。交给 Codex 核对来源、补充答案后，再导入更新的知识包。记录不会自动变成个人经历。"),
            field("公司",feedback.company,v=>setFeedback({...feedback,company:v}),{maxLength:200}),field("岗位",feedback.role,v=>setFeedback({...feedback,role:v}),{maxLength:200}),
            field("实际问题（每行一个）",feedback.questions,v=>setFeedback({...feedback,questions:v}),{area:true,maxLength:20000}),field("补充说明 / 自己核实的答案",feedback.notes,v=>setFeedback({...feedback,notes:v}),{area:true,maxLength:20000}),
            btn("保存复盘记录",async()=>{try{await run("record-interview",{profileId:p.id,...feedback},"复盘已保存，等待核对和补充知识。");setFeedback({company:"",role:"",questions:"",notes:""});}catch{}},busy||!feedback.questions.trim(),{variant:"default"})),
          [...(data.feedback??[])].reverse().map(f=>h("section",{className:"pl-card",key:f.id},h("h3",null,f.title||`${f.company||"未填公司"} · ${f.role||"未填岗位"}`),h("p",{className:"pl-muted"},`${f.createdAt} · 已记录，尚未作为事实入库`),h("p",{className:"pl-content"},f.questions),f.notes&&h("p",{className:"pl-content"},f.notes)))),
        tab==="profile"&&h("section",{className:"pl-card"},h("h2",null,"个人背景"),h("p",{className:"pl-content"},p.background||"尚未填写"),h("h2",null,"已确认的经历与职责"),h("p",{className:"pl-content"},p.confirmedExperience||"尚未填写。AI 提取的个人经历需要在知识卡中确认。"),btn("编辑档案",()=>setProfileEdit({...p}),busy)),
        tab==="materials"&&h(React.Fragment,null,
          h("details",{className:"pl-import-details"},h("summary",null,"导入整理好的知识包"),h("p",{className:"pl-muted"},"导入带原文证据的项目问答，在本机建立索引。"),
            h("input",{type:"file",accept:".json",ref:packagePicker,style:{display:"none"},onChange:async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{if(file.size>24000000)throw new Error("知识包超过24MB，请按项目拆分。");const pack=JSON.parse(await file.text());await run("import-curated",{profileId:p.id,package:pack},"知识包已导入，可以开始面试或测试检索。");}catch(err){setError(err.message||"无法读取知识包。");}}}),
            btn("选择知识包 JSON",()=>packagePicker.current?.click(),busy||unfinished),p.defaultResume&&h("p",{className:"pl-muted"},`默认简历已设置：${p.defaultResume.title}。新建准备档案会自动带入。`)),
          h("section",{className:"pl-card"},h("h2",null,"先放材料，再精炼"),h("p",{className:"pl-muted"},"支持文档、论文、代码、图片和笔记。导入在本机保存；点击 AI 精炼后，分段材料会发送给你配置的模型。"),
            h("label",{className:"pl-field"},h("span",null,"这批材料与我的关系"),h(Select,{value:relationship,onChange:e=>setRelationship(e.target.value)},Object.entries(relations).map(([value,label])=>h("option",{value,key:value},label)))),
            h("div",{className:"pl-actions"},btn("导入文件夹",act("pick-folder",{profileId:p.id,relationship},"已加入后台处理队列。"),busy||unfinished),btn("批量导入文件",act("pick-files",{profileId:p.id,relationship},"已加入后台处理队列。"),busy||unfinished),btn("粘贴文字",()=>setMaterial({name:"",content:"",relationship}),busy),btn("AI 精炼未处理材料",act("distill",{profileId:p.id},"AI 整理任务已开始，可以离开此页面。"),busy||unfinished||!sources.length,{variant:"default"})),
            h("p",{className:"pl-muted"},"每轮最多整理 20 批，完成后可继续。重复导入会复用未变化的材料；关闭软件后可继续未完成的任务。")),
          data.jobs.slice(-5).reverse().map(job=>h("section",{className:"pl-card",key:job.id,"data-job-id":job.id},h("div",{className:"pl-row"},h("h3",null,`${job.kind==="distill"?"AI 精炼":"材料导入"} · ${jobLabels[job.status]}`),h("span",{className:"pl-muted"},`${job.done||0} / ${job.total||0}`)),
            h("p",{role:"status"},job.message),job.total>0&&h("progress",{max:job.total,value:job.done||0}),
            h("div",{className:"pl-actions"},["running","queued"].includes(job.status)&&btn("暂停",act("job-control",{jobId:job.id,control:"pause"}),busy),["paused","failed"].includes(job.status)&&btn("继续 / 重试",act("job-control",{jobId:job.id,control:"resume"}),busy),["running","queued","paused","failed"].includes(job.status)&&btn("取消任务",act("job-control",{jobId:job.id,control:"cancel"}),busy)),
            (job.summary||job.skipped?.length>0)&&h("details",null,h("summary",null,"查看导入详情"),job.summary&&h("p",null,`发现 ${job.summary.discoveredFileCount} 个文件，导入 ${job.summary.importedFileCount} 个，跳过 ${job.summary.skippedFileCount} 项，截断 ${job.summary.truncatedFileCount} 个。${job.summary.limitReached?"已达到本轮扫描限制，建议分目录导入。":""}`),job.skipped?.map((s,i)=>h("p",{key:i,className:"pl-muted"},`${s.path}：${s.reason}`))))),
          h("section",{className:"pl-card"},h("h2",null,"已保存的材料"),!sources.length&&h("p",{className:"pl-muted"},"材料可以很杂，AI 会在精炼时筛选与岗位有关的要点。"),
            sources.map(s=>h("div",{className:"pl-source",key:s.id},h("div",null,h("strong",null,s.name),h("p",{className:"pl-muted"},`${relations[s.relationship]} · v${s.version} · ${s.characters.toLocaleString()} 字${s.aliases?.length?` · 复用 ${s.aliases.length} 份重复材料`:``} · 已整理 ${s.processedBatches}/${s.batches} 批${s.truncated?" · 本材料已截断，请拆分补充":""}`)),h("div",{className:"pl-actions"},btn("查看",()=>showSource(s.id),busy),btn("移除",()=>{if(window.confirm(`移除“${s.name}”及其可用知识卡？`))void run("remove-source",{profileId:p.id,sourceId:s.id}).catch(()=>{});},busy))))),
        ),
        tab==="cards"&&h(React.Fragment,null,
          h("section",{className:"pl-card"},h("div",{className:"pl-row"},h("h2",null,"保留精炼内容，也保留证据"),h("span",{className:"pl-muted"},`${matched.length} 张`)),
            h('label',{className:'pl-field'},h('span',null,'项目'),h(Select,{'aria-label':'筛选项目',value:project,onChange:e=>{setProject(e.target.value);setPage(1);setSearchResult(null);}},h('option',{value:'all'},'全部项目'),projectKeys.map(key=>h('option',{value:key,key},projectNames[key]||key)))),
            h("div",{className:"pl-search"},h("input",{placeholder:"搜索知识卡，或试试一个面试问题",value:query,onChange:e=>{setQuery(e.target.value);setPage(1);setSearchResult(null);}}),h(Select,{value:status,onChange:e=>{setStatus(e.target.value);setPage(1);}},[["all","当前知识卡"],["usable","可用于回答"],["needs_confirmation","个人经历待确认"],["stale","来源已更新"],["rejected","未采用"]].map(([value,label])=>h("option",{value,key:value},label))),btn("测试检索",async()=>{try{setSearchResult(await run("search",{profileId:p.id,query}));}catch{}},busy||!query.trim())),
            h("p",{className:"pl-muted"},"技术卡标明资料来源；个人经历确认后才参与回答。原始材料更新或被移除时，旧卡片会停止使用。")),
          searchResult&&h("section",{className:"pl-card"},h("h3",null,`检索结果 · ${searchResult.citations.length} 条`),!searchResult.citations.length&&h("p",null,"没有找到可用证据，请补充材料或确认相关卡片。"),searchResult.citations.map(c=>h("details",{key:c.evidenceId,open:true},h("summary",null,c.documentName),h("p",{className:"pl-content"},c.snippet)))),
          !matched.length&&h("section",{className:"pl-card pl-empty"},h("p",null,"还没有符合条件的知识卡。先导入材料，再点击 AI 精炼。")),
          matched.slice((page-1)*20,page*20).map(c=>h(KnowledgeCard,{key:c.id,card:c,source:sources.find(s=>s.id===c.sourceId),busy,onReview:review,onSource:showSource})),
          matched.length>20&&h("div",{className:"pl-actions"},btn("上一页",()=>setPage(page-1),page<=1),h("span",null,`${page} / ${Math.ceil(matched.length/20)}`),btn("下一页",()=>setPage(page+1),page*20>=matched.length))
        )
      ),
      preparationName!==null&&h(Modal,{onDismiss:()=>{if(!busy)setPreparationName(null);},className:'pl-modal',role:'dialog','aria-modal':true,'aria-label':'新建面试准备'},h('section',{className:'pl-modal-body cw-small-dialog'},h('h2',null,'为这次准备起个名字'),field('准备档案名称',preparationName,setPreparationName,{maxLength:120,placeholder:'公司 · 岗位 · 轮次'}),h('p',{className:'pl-muted'},'留空会生成带日期的名称，之后可以在侧栏修改。'),h('div',{className:'pl-actions'},btn('取消',()=>setPreparationName(null),busy),btn('创建准备档案',async()=>{try{const result=await run('create-workspace',{profileId:p.id,name:preparationName});setPreparationName(null);location.hash=`/workspaces/${result.workspace.id}`;}catch{}},busy,{variant:'default'})))),
      material&&h(Modal,{onDismiss:()=>{if(!busy)setMaterial(null);},className:"pl-modal",role:"dialog","aria-modal":true,"aria-label":"粘贴材料"},h("section",{className:"pl-modal-body"},h("h2",null,material.identity?"更新材料":"粘贴材料"),field("材料名称",material.name,v=>setMaterial({...material,name:v}),{maxLength:240}),field("材料正文",material.content,v=>setMaterial({...material,content:v}),{area:true,maxLength:240000,placeholder:"粘贴项目说明、读书笔记、论文节选等"}),h("p",{className:"pl-muted"},relations[material.relationship]),h("div",{className:"pl-actions"},btn("保存材料",async()=>{try{await run("import-text",{profileId:p.id,...material},"材料已保存。可点击 AI 精炼提取知识卡。");setMaterial(null);}catch{}},busy||!material.content.trim(),{variant:"default"}),btn("取消",()=>setMaterial(null),busy)))),
      sourceView&&h(Modal,{onDismiss:()=>setSourceView(null),className:"pl-modal",role:"dialog","aria-modal":true,"aria-label":"材料原文"},h("section",{className:"pl-modal-body"},h("h2",null,sourceView.name),h("p",{className:"pl-muted"},`版本 ${sourceView.version} · ${relations[sourceView.relationship]} · 行号对应下方解析后的正文`),h("pre",null,sourceView.content.split("\n").map((line,i)=>`${i+1}  ${line}`).join("\n")),h("div",{className:"pl-actions"},sourceView.identity.startsWith("text:")&&btn("更新文字",()=>{setMaterial({identity:sourceView.identity,name:sourceView.name,content:sourceView.content,relationship:sourceView.relationship});setSourceView(null);},busy),btn("关闭",()=>setSourceView(null)))))
    ));
  };
}

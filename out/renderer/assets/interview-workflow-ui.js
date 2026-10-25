export function createInterviewWorkflowViews({React,Button,Modal="div"}) {
  const h=React.createElement;
  const invoke=(action,input={})=>window.api.interviewWorkflow.invoke(action,input);
  const btn=(label,click,disabled=false)=>h(Button,{size:'sm',variant:'outline',onClick:click,disabled},label);
  const field=(label,value,change,area=false,max=120)=>h('label',{className:'block space-y-1'},h('span',null,label),h(area?'textarea':'input',{className:'w-full rounded-md border bg-background p-2',value,onChange:e=>change(e.target.value),maxLength:max,rows:area?6:undefined}));
  const actions=[['ask','回答最新问题'],['shot','截图提问'],['toggle_auto_answer','自动 / 手动'],['hide','收起 / 展开内容'],['toggle_interaction','鼠标解锁 / 锁定'],['end_session','结束面试'],['toggle_shortcut_panel','显示快捷键']];
  function Settings(){
    const [name,setName]=React.useState(''),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false),[bindings,setBindings]=React.useState([]);
    React.useEffect(()=>{let alive=true;Promise.all([invoke('account'),window.api.shortcuts.getBindings()]).then(([a,b])=>{if(alive){setName(a.name);setBindings(b);}}).catch(e=>alive&&setMessage(e.message));return()=>{alive=false;};},[]);
    async function run(work){setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e.message||'操作失败，请重试。');}finally{setBusy(false);}}
    async function preset(){
      const snapshot=await window.api.shortcuts.getBindings();
      const changes=[['ask','Control+Alt+Space'],['end_session','Control+Alt+Shift+E']];
      const applied=[];
      try{for(const [action,key] of changes){await window.api.shortcuts.setBinding(action,key);applied.push(action);}}
      catch(e){for(const action of applied.reverse()){const old=snapshot.find(b=>b.action===action);await window.api.shortcuts.setBinding(action,old.isDefault?null:old.accelerator);}throw e;}
      setBindings(await window.api.shortcuts.checkConflicts());setMessage('已应用：Ctrl+Alt+空格回答，Ctrl+Alt+Shift+E 结束；其他按键保留。');
    }
    return h('section',{className:'space-y-4 rounded-xl border p-5','data-testid':'workflow-settings'},
      h('h3',{className:'text-ui-title font-medium'},'我的称呼与面试操作'),
      field('显示名称',name,setName,false,60),btn('保存称呼',()=>run(async()=>{const saved=await invoke('save-account',{name});window.dispatchEvent(new CustomEvent('cheater-account-changed',{detail:saved}));setMessage('称呼已保存。');}),busy||!name.trim()),
      h('p',{className:'text-ui text-muted-foreground'},'先熟悉三个动作：回答最新问题、截图提问、结束面试。快捷键只在面试中生效；遇到占用可在「快捷键」设置逐项改绑。'),
      h('div',{className:'flex flex-wrap gap-2'},btn('使用简洁按键方案',()=>run(preset),busy),btn('检查按键占用',()=>run(async()=>{const b=await window.api.shortcuts.checkConflicts();setBindings(b);setMessage(b.some(x=>x.registered===false)?'部分按键被占用，请到快捷键设置修改。':'当前按键检查完成。');}),busy)),
      h('ul',{className:'space-y-1'},actions.map(([action,label])=>{const b=bindings.find(x=>x.action===action);return h('li',{key:action},`${label}：${b?.accelerator?.replaceAll('Control','Ctrl')??'未设置'}${b?.registered===false?'（被占用）':''}`);})),
      h('details',null,h('summary',{className:'cursor-pointer'},'第一次体验：完整流程与回答原理'),
        h('ol',{className:'list-decimal pl-6 space-y-2 mt-3'},
          h('li',null,'在 AI 连接配置并测试服务商；在音频设置选择麦克风和系统播放设备，戴耳机减少回声。'),
          h('li',null,'打开个人资料与知识库，核对当前档案和待确认贡献，点击「用此资料准备面试」，补充本次 JD。'),
          h('li',null,'开始实时面试。先用手动回答熟悉操作：等待对方转写完整，再按回答最新问题；算法图片用截图提问。'),
          h('li',null,'结束面试后打开记录，点击「命名与复盘」，保存名称、笔记，导出 PDF 或完整 JSON，再把问题转入知识库复盘。')),
        h('p',{className:'mt-3'},'声音分为麦克风和系统音频 → ASR 转写 → 当前问题与对话指代 → 本地知识检索 → 已核对原题直接展示，其他问题由所选模型结合证据回答 → 本机保存文字记录。'),
        h('p',{className:'mt-2'},'LeetCode / 算法：识别题目后要求思路、代码、复杂度和边界测试；八股题使用模型通用知识及已导入材料。没有内置完整 LeetCode 题库，也不会在本机自动执行模型生成的代码。'),
        h('p',{className:'mt-2'},'记录保存双方转写、问题、AI 参考答案及引用；不录制原始音频或视频。AI 参考答案与本人真实发言分开展示。')),
      message&&h('p',{role:'status',className:'text-ui'},message));
  }
  function Record({interviewId}) {
    const [open,setOpen]=React.useState(false),[record,setRecord]=React.useState(null),[title,setTitle]=React.useState(''),[notes,setNotes]=React.useState(''),[company,setCompany]=React.useState(''),[role,setRole]=React.useState(''),[keywords,setKeywords]=React.useState(''),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);
    async function run(fn){setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message||'操作失败');}finally{setBusy(false);}}
    async function show(){await run(async()=>{const r=await invoke('record',{interviewId});setRecord(r);setTitle(r.title);setNotes(r.reviewNotes??'');setCompany(r.company??'');setRole(r.jobRole??'');setKeywords((r.keywords??[]).join('，'));setOpen(true);});}
    async function save(){const r=await invoke('save-record',{interviewId,title,reviewNotes:notes,company,jobRole:role,keywords:keywords.split(/[,，、]/).map(x=>x.trim()).filter(Boolean)});setRecord(r);return r;}
    const statuses={completed:'已完成',failed:'失败',cancelled:'已取消',generating:'未完成 / 中断'};
    return h(React.Fragment,null,btn('命名与复盘',show,busy),!open&&message&&h('span',{role:'status'},message),open&&h(Modal,{onDismiss:()=>{if(!busy)setOpen(false);},className:'pl-modal',role:'dialog','aria-modal':true,'aria-label':'面试命名与复盘'},h('section',{className:'pl-modal-body space-y-4'},
      h('h2',null,'面试命名与复盘'),field('记录名称',title,setTitle),h('div',{className:'cb-field-grid'},field('公司',company,setCompany,false,100),field('岗位',role,setRole,false,100)),field('关键词（逗号分隔）',keywords,setKeywords,false,400),field('复盘笔记',notes,setNotes,true,30000),
      h('div',{className:'flex flex-wrap gap-2'},
        btn('保存名称与笔记',()=>run(async()=>{await save();setMessage('名称与笔记已保存。关闭后记录列表会更新。');}),busy),
        btn('导出完整 JSON',()=>run(async()=>{await save();const r=await invoke('export-json',{interviewId});setMessage(r.canceled?'已取消导出':'完整文字记录已导出。');}),busy),
        btn('转入知识库复盘',()=>run(async()=>{await save();await invoke('review-to-library',{interviewId});setMessage('问题与笔记已转入对应档案；重复点击会更新同一条复盘。AI 答案不会自动成为已确认事实。');}),busy),
        btn('关闭',()=>{setOpen(false);location.reload();},busy)),
      message&&h('p',{role:'status'},message),
      h('p',{className:'text-sm text-muted-foreground'},'完整 JSON 包含转写修订、提问、AI 回答、检索证据快照及失败 / 取消记录。原始音频、视频、截图图像未录制。'),
      h('details',null,h('summary',null,`双方转写（${record?.transcripts?.length??0} 条）`),(record?.transcripts??[]).map((t,i)=>h('div',{key:i,className:'border-t py-2'},h('strong',null,t.source==='mic'?'我的发言':'对方 / 系统声音'),h('p',{className:'whitespace-pre-wrap'},t.content)))),
      h('details',null,h('summary',null,`回答过程（${record?.answerAttempts?.length??0} 次）`),(record?.answerAttempts??[]).map(t=>h('div',{key:t.id,className:'border-t py-2'},h('strong',null,`${statuses[t.status]??t.status} · ${t.question}`),h('p',{className:'whitespace-pre-wrap'},t.partialText||t.error||'尚无回答'),t.evidence?.length>0&&h('small',null,`引用：${t.evidence.map(e=>e.title).join('；')}`)))))));
  }
  function changed(detail){window.dispatchEvent(new CustomEvent('cheater-records-changed',{detail}));}
  function RecordActions({interviewId,title,status,detail=false}) {
    const [mode,setMode]=React.useState(null),[name,setName]=React.useState(title||''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    const menu=React.useRef(null);
    function open(next){if(menu.current)menu.current.open=false;setName(title||'');setError('');setMode(next);}
    async function submit(){setBusy(true);setError('');try{
      const result=await invoke(mode==='delete'?'delete-record':'save-record',{interviewId,...(mode==='rename'?{title:name}: {})});
      changed({action:mode==='delete'?'deleted':'renamed',id:interviewId,title:result.title});setMode(null);
      if(detail&&mode==='delete')location.hash='/interviews';
    }catch(e){setError(e.message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')||'操作失败，请重试。');}finally{setBusy(false);}}
    return h(React.Fragment,null,
      h('details',{ref:menu,className:'cw-record-menu'},h('summary',{'aria-label':`管理记录：${title||'未命名面试'}`,title:'重命名或删除记录'},'⋯'),
        h('div',{className:'cw-menu-items'},h('button',{type:'button',onClick:()=>open('rename')},'重命名'),h('button',{type:'button',onClick:()=>open('delete'),disabled:status==='in_progress',title:status==='in_progress'?'请先结束面试':undefined},'删除记录'))),
      mode&&h(Modal,{onDismiss:()=>{if(!busy)setMode(null);},className:'pl-modal',role:'dialog','aria-modal':true,'aria-label':mode==='delete'?'删除面试记录':'重命名面试记录',onKeyDown:e=>{if(e.key==='Escape'&&!busy)setMode(null);}},h('section',{className:'pl-modal-body cw-small-dialog'},
        h('h2',null,mode==='delete'?'删除这条记录？':'重命名面试记录'),
        mode==='delete'?h(React.Fragment,null,h('p',{className:'cw-record-name'},title||'未命名面试'),h('p',{className:'text-muted-foreground'},'将移至已删除记录，可随时恢复。个人知识库和已保存的复盘不会删除。')):
          h('label',{className:'pl-field'},h('span',null,'记录名称'),h('input',{autoFocus:true,value:name,maxLength:120,placeholder:'例如：公司 · 算法实习 · 一面',onChange:e=>setName(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&name.trim()&&!busy)void submit();}})),
        error&&h('p',{role:'alert',className:'pl-alert'},error),h('div',{className:'pl-actions'},btn('取消',()=>setMode(null),busy),h(Button,{size:'sm',variant:mode==='delete'?'destructive':'default',disabled:busy||(mode==='rename'&&!name.trim()),onClick:submit},busy?'处理中…':mode==='delete'?'确认删除':'保存名称')))));
  }
  function RecordTools(){
    const [last,setLast]=React.useState(null),[open,setOpen]=React.useState(false),[records,setRecords]=React.useState([]),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    React.useEffect(()=>{const onChange=e=>{if(e.detail?.action==='deleted')setLast(e.detail);};window.addEventListener('cheater-records-changed',onChange);return()=>window.removeEventListener('cheater-records-changed',onChange);},[]);
    async function load(){setError('');setBusy(true);try{setRecords(await invoke('deleted-records'));setOpen(true);}catch(e){setError(e.message);}finally{setBusy(false);}}
    async function restore(id){setBusy(true);setError('');try{await invoke('restore-record',{interviewId:id});setLast(null);setRecords(r=>r.filter(x=>x.id!==id));changed({action:'restored',id});}catch(e){setError(e.message);}finally{setBusy(false);}}
    return h('div',{className:'cw-record-tools'},
      last&&h('div',{role:'status',className:'cw-undo'},h('span',null,`已删除“${last.title}”`),btn('撤销',()=>restore(last.id),busy)),
      btn('已删除记录',load,busy),error&&h('p',{role:'alert'},error),
      open&&h(Modal,{onDismiss:()=>{if(!busy)setOpen(false);},className:'pl-modal',role:'dialog','aria-modal':true,'aria-label':'已删除记录',onKeyDown:e=>{if(e.key==='Escape')setOpen(false);}},h('section',{className:'pl-modal-body'},h('div',{className:'pl-row'},h('h2',null,'已删除记录'),btn('关闭',()=>setOpen(false),busy)),
        records.length?records.map(r=>h('div',{className:'pl-source',key:r.id},h('div',null,h('strong',null,r.title),h('p',{className:'pl-muted'},`删除于 ${new Date(r.deletedAt).toLocaleString('zh-CN')}`)),btn('恢复',()=>restore(r.id),busy))):h('p',{className:'pl-empty'},'没有已删除的记录。'))));
  }
  return {Settings,Record,RecordActions,RecordTools};
}

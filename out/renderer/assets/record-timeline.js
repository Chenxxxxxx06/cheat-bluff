// Cheat Bluff · undestand. Search runs against all local records, not the visible page.
export function createRecordTimeline({React,Link,Actions,Tools}){
 const h=React.createElement,invoke=(input)=>window.api.interviewWorkflow.invoke('search-records',input);
 return function Timeline(){
  const [query,setQuery]=React.useState(''),[offset,setOffset]=React.useState(0),[data,setData]=React.useState({records:[],total:0}),[busy,setBusy]=React.useState(true),[error,setError]=React.useState(''),[revision,refresh]=React.useReducer(x=>x+1,0);
  const input=React.useRef(null);
  React.useEffect(()=>{const listener=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&!document.querySelector('[role=dialog]')){e.preventDefault();input.current?.focus();input.current?.select();}};const changed=()=>refresh();window.addEventListener('keydown',listener);window.addEventListener('cheater-records-changed',changed);return()=>{window.removeEventListener('keydown',listener);window.removeEventListener('cheater-records-changed',changed);};},[]);
  React.useEffect(()=>{let alive=true;setBusy(true);const timer=setTimeout(()=>invoke({query,offset}).then(result=>{if(alive){setData(result);setError('');if(offset&&offset>=result.total)setOffset(0);}}).catch(e=>alive&&setError(e.message)).finally(()=>alive&&setBusy(false)),150);return()=>{alive=false;clearTimeout(timer);};},[query,offset,revision]);
  const day=date=>new Date(date).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});
  const time=date=>new Date(date).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  return h('div',{className:'cb-record-scroll'},h('main',{className:'cb-records'},
   h('header',{className:'cb-record-header'},h('div',null,h('h1',null,'面试记录'),h('p',null,'每一次交流，都有迹可循。')),h(Tools)),
   h('label',{className:'cb-record-search'},h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},h('circle',{cx:10,cy:10,r:6}),h('path',{d:'m15 15 5 5'})),h('input',{ref:input,value:query,placeholder:'搜索公司、岗位、关键词或对话内容',maxLength:200,onChange:e=>{setQuery(e.target.value);setOffset(0);},onKeyDown:e=>{if(e.key==='Escape'){setQuery('');setOffset(0);input.current.blur();}},'aria-label':'搜索全部面试记录'}),h('kbd',null,'Ctrl F')),
   h('div',{className:'cb-record-count',role:'status'},error|| (busy?'正在查找…':`${data.total} 场面试`)),
   h('ol',{className:'cb-timeline','aria-label':'面试时间线','aria-busy':busy},data.records.map((r,index)=>h('li',{key:r.id,className:'cb-timeline-item'},
    h('span',{className:'cb-timeline-dot','aria-hidden':true}),
    h(Link,{to:'/interviews/$interviewId',params:{interviewId:r.id},className:'cb-timeline-link'},
     h('time',{dateTime:r.startAt},day(r.startAt),' · ',time(r.startAt),r.durationSeconds!=null?` · ${Math.max(1,Math.round(r.durationSeconds/60))} 分钟`:''),
     h('div',{className:'cb-record-title'},h('span',{className:'cb-company-mark','aria-hidden':true},(r.company||r.title).slice(0,1)),h('div',null,h('h2',null,r.title), (r.company||r.role)&&h('p',null,[r.company,r.role].filter(Boolean).join(' · ')))),
     h('div',{className:'cb-keywords'},h('span',{className:'cb-status'},r.status==='in_progress'?'进行中':r.status==='ended'?'已结束':'未开始'),...r.keywords.map(word=>h('span',{key:word},word)))),
    h(Actions,{interviewId:r.id,title:r.title,status:r.status})))),
   !busy&&!error&&!data.total&&h('p',{className:'cb-empty'},query?'没有匹配的记录，换个关键词试试。':'还没有面试记录。完成面试后会自动保存在这里。'),
   error&&h('button',{onClick:refresh},'重试'),
   data.total>30&&h('nav',{className:'cb-pagination','aria-label':'记录分页'},h('button',{disabled:!offset||busy,onClick:()=>setOffset(x=>Math.max(0,x-30))},'上一页'),h('span',null,`${offset+1}–${Math.min(offset+30,data.total)} / ${data.total}`),h('button',{disabled:offset+30>=data.total||busy,onClick:()=>setOffset(x=>x+30)},'下一页'))));
 };
}

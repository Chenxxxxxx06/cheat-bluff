export function createHomeView({React,Button,StartButton,Modal="div",Select="select"}) {
  const h=React.createElement;
  return function Home({onShortcut,onPrepare,onLibrary,disabled=false}) {
    const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[creating,setCreating]=React.useState(false),[name,setName]=React.useState(''),[busy,setBusy]=React.useState(false);
    React.useEffect(()=>{let alive=true;window.api.personalLibrary.invoke('snapshot').then(d=>{if(alive)setData(d);}).catch(()=>{});return()=>{alive=false;};},[]);
    const profile=data?.profile;
    async function prepare(){
      setBusy(true);setError('');
      try{await onPrepare(name.trim(),profile?.id);setCreating(false);}catch(e){setError(e.message||'创建失败，请重试。');}finally{setBusy(false);}
    }
    return h('section',{className:'cw-home','aria-label':'开始面试与准备'},
      h('svg',{className:'cx-home-mark',viewBox:'0 0 48 48',fill:'none',stroke:'currentColor',strokeWidth:2,'aria-hidden':true},h('path',{d:'M13 12c0-6 8-8 12-4 6-2 12 2 12 8 6 3 6 12 1 15-1 8-9 12-16 8-7 3-14-2-14-9-6-5-3-15 5-18Z'}),h('path',{d:'m17 20 5 5-5 5m11 0h6'})),
      h('h1',null,'准备好下一场面试'),
      h('div',{className:'cw-home-actions','data-slot':'direct-interview-start'},
        h(StartButton,{workspaceId:null,label:'开始面试',className:'cw-start-primary'}),
        h(Button,{variant:'outline',className:'cw-prepare-button',disabled:disabled||busy,onClick:()=>{setName('');setError('');setCreating(true);}},'准备本次面试')),
      creating&&h(Modal,{className:'pl-modal',onDismiss:()=>{if(!busy)setCreating(false);},role:'dialog','aria-modal':true,'aria-label':'新建面试准备',onKeyDown:e=>{if(e.key==='Escape'&&!busy)setCreating(false);}},h('section',{className:'pl-modal-body cw-small-dialog'},h('h2',null,'为这次准备起个名字'),
        h('p',{className:'pl-muted'},'例如：字节 · 算法实习 · 一面。之后可以随时修改。'),h('label',{className:'pl-field'},h('span',null,'准备档案名称'),h('input',{autoFocus:true,value:name,maxLength:120,placeholder:'公司 · 岗位 · 轮次',onChange:e=>setName(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&!busy)void prepare();}})),
        error&&h('p',{role:'alert',className:'pl-alert'},error),h('div',{className:'pl-actions'},h(Button,{variant:'outline',disabled:busy,onClick:()=>setCreating(false)},'取消'),h(Button,{disabled:busy,onClick:prepare},busy?'创建中…':'创建准备档案')))));
  };
}

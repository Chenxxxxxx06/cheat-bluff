// Original, screenshot-guided shell. Business operations stay in the existing React/IPC views.
export const codexInterface=true;
document.documentElement.dataset.interface='codex';
const markRoute=()=>{document.documentElement.dataset.surface=location.hash.startsWith('#/overlay')?'overlay':'desktop';};
markRoute();window.addEventListener('hashchange',markRoute);

export function createDesktopShell({React,Sidebar,Groups,Link,useLocation,useSidebar,openSettings}) {
  const h=React.createElement;
  const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z',history:'M3 12a9 9 0 1 0 3-6M3 3v5h5M12 7v5l-3 2',library:'M4 4h6v16H4ZM14 4h6v16h-6Z',settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',search:'M20 20l-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',write:'M13 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 3l5 5-9 9-5 1 1-5Z',back:'m14 6-6 6 6 6',next:'m10 6 6 6-6 6',panel:'M3 4h18v16H3ZM9 4v16',chevron:'m8 10 4 4 4-4',cards:'M4 5h16v14H4ZM8 9h8M8 13h5',user:'M5 21v-2a7 7 0 0 1 14 0v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8'};
  const icon=(name)=>h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.65,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]||paths.folder}));
  function InterfaceMenu(){return h('span',{className:'cx-brand'},'Cheat Bluff');}
  function Chrome(){const {toggleSidebar}=useSidebar();return h('header',{className:'cx-chrome app-drag'},h('div',{className:'cx-chrome-actions app-no-drag'},h('button',{title:'后退','aria-label':'后退',onClick:()=>history.back()},icon('back')),h('button',{title:'前进','aria-label':'前进',onClick:()=>history.forward()},icon('next')),h('button',{title:'切换侧栏','aria-label':'切换侧栏',onClick:toggleSidebar},icon('panel'))),h(InterfaceMenu));}
  function ShellSidebar(){
    const {pathname}=useLocation(), {state,setWidth,width}=useSidebar();
    const drag=React.useRef(false);
    React.useEffect(()=>{const sync=()=>{const saved=Number(localStorage.getItem('cheat-bluff.sidebar-width'))||280;setWidth(`${Math.max(230,Math.min(420,Math.floor(window.innerWidth*.3),saved))}px`);};sync();window.addEventListener('resize',sync);return()=>window.removeEventListener('resize',sync);},[]);
    const resize=(value)=>{const next=Math.round(Math.max(230,Math.min(420,Math.floor(window.innerWidth*.3),value)));setWidth(`${next}px`);localStorage.setItem('cheat-bluff.sidebar-width',String(next));};
    const section=pathname.startsWith('/knowledge-bases')?'library':pathname.startsWith('/interviews')?'history':'home';
    const [search,setSearch]=React.useState(false),[query,setQuery]=React.useState(''),[tab,setTab]=React.useState('projects');
    const container=React.useRef(null),input=React.useRef(null);
    React.useEffect(()=>{if(search)input.current?.focus();},[search]);
    React.useEffect(()=>{const sync=e=>setTab(e.detail);window.addEventListener('cheater-library-tab-changed',sync);return()=>window.removeEventListener('cheater-library-tab-changed',sync);},[]);
    React.useEffect(()=>{
      const root=container.current;if(!root)return;
      const filter=()=>root.querySelectorAll('[data-slot="sidebar-menu-item"]').forEach(el=>{const link=el.querySelector('a[href*="/workspaces/"]');if(link)el.hidden=!!query&&!link.textContent.toLowerCase().includes(query.toLowerCase());});
      filter();const observer=new MutationObserver(filter);observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect();
    },[query,section]);
    const libraryTab=value=>{setTab(value);window.dispatchEvent(new CustomEvent('cheater-library-tab',{detail:value}));};
    const railLink=(name,label,to,key)=>h(Link,{to,className:'cx-rail-button'+(section===key?' is-active':''),'aria-current':section===key?'page':undefined,'aria-label':label,title:label},icon(name));
    return h(React.Fragment,null,
      h('nav',{className:'cx-rail app-no-drag','aria-label':'主导航'},railLink('home','面试准备','/','home'),railLink('library','个人资料与知识库','/knowledge-bases','library'),railLink('history','面试记录','/interviews','history'),h('div',{className:'cx-rail-divider'}),h('button',{className:'cx-rail-button',title:'AI 与本地数据','aria-label':'AI 与本地数据',onClick:()=>openSettings('account')},icon('settings')),h('div',{className:'cx-rail-spacer'}),h('button',{className:'cx-avatar',title:'个人设置','aria-label':'个人设置',onClick:()=>openSettings('general')},'C')),
      h(Sidebar,{collapsible:'offcanvas',className:'cx-sidebar app-no-drag'},
        h('div',{className:'cx-sidebar-heading'},h('strong',null,section==='library'?'资料空间':section==='history'?'面试记录':'Cheat Bluff'),h('button',{title:'搜索准备档案','aria-label':'搜索准备档案','aria-expanded':search,onClick:()=>{setSearch(!search);if(search)setQuery('');}},icon('search'))),
        search&&h('label',{className:'cx-search'},icon('search'),h('input',{ref:input,placeholder:'搜索准备档案',value:query,onChange:e=>setQuery(e.target.value),onKeyDown:e=>{if(e.key==='Escape'){setQuery('');setSearch(false);}}})),
        section==='library'&&!search?h('nav',{className:'cx-secondary-nav','aria-label':'资料分类'},[['projects','全部项目','folder'],['cards','问答与口述','cards'],['materials','材料','library'],['profile','个人档案','user'],['feedback','面试复盘','history']].map(([key,label,name])=>h('button',{key,type:'button','aria-current':tab===key?'page':undefined,onClick:()=>libraryTab(key)},icon(name),label))):h(Link,{to:'/',className:'cx-new-chat'},icon('write'),'新准备'),
        h('div',{className:'cx-groups',ref:container},h(Groups,{className:'cx-workspaces'})),
        h('div',{className:'cx-sidebar-bottom'},h('button',{onClick:()=>openSettings('account')},icon('settings'),'AI 与本地数据')),
        state!=='collapsed'&&h('div',{className:'cb-sidebar-resizer',role:'separator',tabIndex:0,'aria-label':'调整侧栏宽度','aria-orientation':'vertical','aria-valuenow':parseInt(width)||280,'aria-valuemin':230,'aria-valuemax':420,onDoubleClick:()=>resize(280),onKeyDown:e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();resize((parseInt(width)||280)+(e.key==='ArrowRight'?16:-16));}},onPointerDown:e=>{drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();},onPointerMove:e=>{if(drag.current)resize(e.clientX-56);},onPointerUp:e=>{drag.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);},onPointerCancel:()=>{drag.current=false;}})));
  }
  function ComposerMeta(){
    const [model,setModel]=React.useState('');
    React.useEffect(()=>{let active=true;const refresh=()=>window.api.aiSettings.get().then(s=>{if(active)setModel(s.textModel);}).catch(()=>{});refresh();window.addEventListener('cheater-ai-settings-changed',refresh);return()=>{active=false;window.removeEventListener('cheater-ai-settings-changed',refresh);};},[]);
    return h('button',{type:'button',className:'cx-composer-model',title:'当前回答模型 · 打开 AI 设置',onClick:()=>openSettings('account')},(!model||model.startsWith('your-'))?'配置模型':model,icon('chevron'));
  }
  return {Sidebar:ShellSidebar,Chrome,InterfaceMenu,ComposerMeta};
}

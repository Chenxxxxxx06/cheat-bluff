// Original Cheat Bluff record discovery · undestand. Local-only, no model calls.
const terms=['Python','TypeScript','JavaScript','C++','Java','SQL','RAG','Agent','LLM','VLM','VLA','Transformer','LoRA','React','Vue','Node.js','Docker','Kubernetes','Redis','MySQL','PostgreSQL','Linux','PyTorch','CUDA','机器学习','深度学习','算法','检索','多模态','具身智能','数据分析','前端','后端','全栈','测试','产品','运营'];
export function discoverRecord(record,workspace={}){
 const title=String(record.title||'未命名面试');
 const text=[title,record.company,record.jobRole,record.reviewNotes,record.jobRole?null:workspace.title,record.jobRole?null:workspace.name,workspace.jobDescription,...(record.transcripts??[]).map(x=>x.content),...(record.answers??[]).filter(x=>x.role==='user').map(x=>x.content)].filter(Boolean).join(' ').slice(0,100000);
 const parts=title.split(/\s*[·｜|]\s*/).filter(Boolean);
 const role=record.jobRole||workspace.role||parts.find(x=>/工程师|开发|实习|算法|研究|产品|运营|分析|设计|测试/.test(x))||'';
 const company=record.company||workspace.company||((parts.length>1&&!/面试|实习|算法|项目|验收|测试|准备/.test(parts[0]))?parts[0]:'');
 const keywords=[...new Set([...(record.keywords??[]),...terms.filter(term=>/^[A-Za-z]/.test(term)?new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-z0-9])`,'i').test(text):text.includes(term))])].slice(0,8);
 return {id:record.id,title,company,role,keywords,startAt:record.startAt||record.createdAt,endAt:record.endAt,durationSeconds:record.durationSeconds,status:record.status,searchText:text.toLocaleLowerCase()};
}
export function searchRecords(records,workspaces=[],query='',offset=0,limit=30){
 const byId=new Map(workspaces.map(x=>[x.id,x]));
 const tokens=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const rows=records.filter(x=>!x.deletedAt).map(x=>discoverRecord(x,byId.get(x.workspaceId))).filter(x=>tokens.every(t=>`${x.searchText} ${x.company} ${x.role} ${x.startAt} ${x.keywords.join(' ')}`.toLocaleLowerCase().includes(t))).sort((a,b)=>String(b.startAt).localeCompare(String(a.startAt)));
 return {total:rows.length,records:rows.slice(offset,offset+limit).map(({searchText,...row})=>row)};
}

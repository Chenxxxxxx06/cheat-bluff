import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {authorizeRecordExport} from './interview-export.mjs';
import {searchRecords} from './record-discovery.mjs';

export function validateDisplayName(value) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>60||/[\x00-\x1f]/.test(value))throw Error('称呼请输入 1–60 个字符。');
  return value.trim();
}
export function validateReviewPatch(input) {
  if(!input||typeof input!=='object')throw Error('记录格式错误。');
  const patch={};
  for(const [key,max] of [['title',120],['reviewNotes',30000],['company',100],['jobRole',100]])if(Object.hasOwn(input,key)){
    if(typeof input[key]!=='string'||input[key].length>max||(key==='title'&&!input[key].trim()))throw Error(key==='title'?'记录名称请输入 1–120 个字符。':'复盘笔记最多 30000 个字符。');
    patch[key]=input[key].trim();
  }
  if(Object.hasOwn(input,'keywords')){if(!Array.isArray(input.keywords)||input.keywords.length>12||input.keywords.some(x=>typeof x!=='string'||x.length>40))throw Error('关键词最多12个，每个不超过40字。');patch.keywords=[...new Set(input.keywords.map(x=>x.trim()).filter(Boolean))];}
  return patch;
}
export function interviewTimeline(interview) {
  return [...(interview.transcripts??[]).map(t=>({...t,kind:'transcript'})),...(interview.answers??[]).map(a=>({...a,kind:a.role==='user'?'question':'ai_reference'})),...(interview.answerAttempts??[]).filter(a=>a.status!=='completed').map(a=>({...a,kind:'incomplete_answer'}))]
    .sort((a,b)=>String(a.createdAt??'').localeCompare(String(b.createdAt??'')));
}
export function buildInterviewArchive(interview) {
  return {schemaVersion:1,exportedAt:new Date().toISOString(),record:structuredClone(interview),timeline:interviewTimeline(interview),
    limitations:['语音内容为转写文字，未保存原始音频。','AI 参考回答不代表候选人实际发言或已确认贡献。','未保存截图图像；保留提问是否携带截图的标记。']};
}
export function visibleInterviews(records) {
  return records.filter(record => !record.deletedAt);
}
export async function recoverInterruptedInterviews(store) {
  if(!store.state.interviews.some(r=>r.status==='in_progress'))return;
  await store.update(state=>{
    for(const record of state.interviews){
      if(record.status!=='in_progress')continue;
      const observed=[record.startAt,record.updatedAt,...(record.transcripts??[]).map(t=>t.updatedAt??t.createdAt),...(record.answers??[]).map(a=>a.createdAt),...(record.answerAttempts??[]).map(a=>a.updatedAt??a.createdAt)].map(Date.parse).filter(Number.isFinite);
      const end=observed.length?Math.max(...observed):Date.now();
      Object.assign(record,{status:'ended',endAt:new Date(end).toISOString(),durationSeconds:Math.max(0,Math.floor((end-(Date.parse(record.startAt)||end))/1000)),interruptionReason:'application_restarted',updatedAt:new Date().toISOString()});
      for(const attempt of record.answerAttempts??[])if(attempt.status==='generating')Object.assign(attempt,{status:'cancelled',error:'上次运行中断，保留已生成内容。'});
    }
  });
}
export async function setInterviewDeleted(store, interviewId, deleted) {
  let result;
  await store.update(state => {
    const record = state.interviews.find(item => item.id === interviewId);
    if (!record) throw Error('找不到面试记录。');
    if (deleted && record.status === 'in_progress') throw Error('请先结束这场面试，再删除记录。');
    if (deleted) record.deletedAt ??= new Date().toISOString();
    else delete record.deletedAt;
    record.updatedAt = new Date().toISOString();
    result = {id:record.id,title:record.title,deletedAt:record.deletedAt??null};
  });
  return result;
}
export function registerInterviewWorkflowIpc({ipcMain,BrowserWindow,dialog,store}) {
  const guard=event=>{if(!authorizeRecordExport(event,BrowserWindow))throw Error('当前页面无权管理面试记录。');};
  ipcMain.handle('interview-workflow:invoke',async(event,action,input={})=>{
    guard(event);
    if(action==='search-records')return searchRecords(store.state.interviews,store.state.workspaces,String(input.query??'').slice(0,200),Math.max(0,Number(input.offset)||0),30);
    if(action==='account')return {name:store.state.user.name};
    if(action==='save-account'){const name=validateDisplayName(input.name);await store.update(state=>{state.user.name=name;state.user.updatedAt=new Date().toISOString();});return {name};}
    if(action==='deleted-records')return store.state.interviews.filter(r=>r.deletedAt).map(r=>({id:r.id,title:r.title,deletedAt:r.deletedAt})).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
    if(typeof input.interviewId!=='string')throw Error('无效面试编号。');
    if(action==='delete-record')return setInterviewDeleted(store,input.interviewId,true);
    if(action==='restore-record')return setInterviewDeleted(store,input.interviewId,false);
    const current=()=>{const r=store.state.interviews.find(i=>i.id===input.interviewId&&!i.deletedAt);if(!r)throw Error('找不到面试记录，可能已删除。');return r;};
    if(action==='record')return structuredClone(current());
    if(action==='save-record'){const patch=validateReviewPatch(input);await store.update(()=>Object.assign(current(),patch,{updatedAt:new Date().toISOString()}));return structuredClone(current());}
    if(action==='review-to-library'){
      let saved;
      await store.update(state=>{
        const record=current();const profile=state.personalLibrary.profiles.find(p=>p.id===record.personalProfileId);
        if(!profile)throw Error('本次面试没有关联个人档案。请先在个人资料库创建档案。');
        const questions=[...new Set([...(record.transcripts??[]).filter(t=>t.source==='media'&&t.isFinal!==false).map(t=>t.content),...(record.answers??[]).filter(a=>a.role==='user').map(a=>a.content),...(record.answerAttempts??[]).map(a=>a.question)].filter(Boolean))].join('\n');
        if(!questions)throw Error('没有可转入复盘的问题。');
        state.personalLibrary.feedback??=[];
        saved=state.personalLibrary.feedback.find(f=>f.interviewId===record.id);
        const fields={profileId:profile.id,interviewId:record.id,title:record.title,questions,notes:record.reviewNotes??'',updatedAt:new Date().toISOString(),status:'recorded_not_facts'};
        if(saved)Object.assign(saved,fields);else{saved={id:randomUUID(),createdAt:new Date().toISOString(),...fields};state.personalLibrary.feedback.push(saved);}
      });return {id:saved.id};
    }
    if(action==='export-json'){
      const archive=buildInterviewArchive(current());const name=archive.record.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70);
      const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'导出完整文字记录',defaultPath:`Cheater-${name}.json`,filters:[{name:'JSON 记录',extensions:['json']}],properties:['showOverwriteConfirmation']});
      if(result.canceled||!result.filePath)return {canceled:true};await writeFile(result.filePath,JSON.stringify(archive,null,2)+'\n');return {canceled:false};
    }
    throw Error('未知操作。');
  });
}

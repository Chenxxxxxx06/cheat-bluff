import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,readdir,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {ReplicaDataStore} from "../out/main/local-api/data-store.mjs";
import {KnowledgeIndex} from "../out/main/knowledge/knowledge-index.mjs";
import {createPersonalLibrary,sourceBatches,normalizeKnowledgeCards,usablePersonalCards} from "../out/main/knowledge/personal-library.mjs";
import {retrieveWorkspaceKnowledge,startReplicaApiServer} from "../out/main/local-api/server.mjs";

const material="二分查找在有序数组中每次排除一半候选元素，时间复杂度为 O(log n)。\n我负责项目的检索模块，实现了缓存和查询追踪，并编写了回归测试。";
async function setup(t, options={}) {
  const directory=await mkdtemp(join(tmpdir(),"cheater-personal-"));
  const store=await new ReplicaDataStore(directory).initialize();let calls=0,embeds=0;
  const aiService={complete:async input=>{calls++;if(options.complete)return options.complete(input,calls);const payload=JSON.parse(input.messages.at(-1).content);const quote=payload.material.split("\n")[0];
    return JSON.stringify({cards:[{title:"二分查找",summary:"有序数组的二分查询每轮缩小候选范围。",quote,kind:"knowledge",tags:["二分查找"],question:"二分查找为何是对数复杂度？"},
      ...(payload.material.includes("我负责")?[{title:"检索模块贡献",summary:"我负责项目的检索模块和回归测试。",quote:payload.material.split("\n")[1],kind:"personal",tags:["检索"]}]:[])]});},
    embed:async items=>{embeds++;return {model:"test-embedding",vectors:items.map(()=>[1,0,1])};}};
  const index=await new KnowledgeIndex({filePath:join(directory,"index.json"),aiService}).initialize();
  const library=createPersonalLibrary({store,knowledgeIndex:index,aiService});await library.initialize();t.after(()=>library.close());
  const profile=await library.dispatch("save-profile",{name:"甲同学",targetRole:"算法工程师",confirmedExperience:"本人负责检索服务。"});
  return {directory,store,index,library,profile,aiService,calls:()=>calls,embeds:()=>embeds};
}
async function terminal(library,id){for(let i=0;i<500;i++){const j=library.snapshot().jobs.find(j=>j.id===id);if(j&&["completed","failed","paused","cancelled"].includes(j.status))return j;await delay(10);}throw Error("job timed out");}

test("materials persist separately; distillation is reusable, cited, and personal claims need confirmation",async t=>{
  const x=await setup(t);const {library,profile,store,index}=x;
  const source=await library.dispatch("import-text",{profileId:profile.id,name:"项目说明",content:material,relationship:"mine"});
  assert.equal((await readFile(store.filePath,"utf8")).includes(material),false);
  assert.equal((await library.dispatch("source",{profileId:profile.id,sourceId:source.id})).content,material);
  let job=await library.dispatch("distill",{profileId:profile.id});assert.equal((await terminal(library,job.jobId)).status,"completed");
  assert.equal(x.calls(),1);let snapshot=library.snapshot();assert.equal(snapshot.cards.length,2);
  const personal=snapshot.cards.find(c=>c.kind==="personal");assert.equal(personal.status,"needs_confirmation");
  assert.equal(usablePersonalCards(store,profile.id).length,1);
  await assert.rejects(()=>library.dispatch("review-card",{profileId:profile.id,cardId:personal.id,status:"confirmed"}),/明确确认/);
  await library.dispatch("review-card",{profileId:profile.id,cardId:personal.id,status:"confirmed",confirmOwnership:true});
  assert.equal(usablePersonalCards(store,profile.id).length,2);
  job=await library.dispatch("distill",{profileId:profile.id});await terminal(library,job.jobId);assert.equal(x.calls(),1);
  const reused=await library.dispatch("import-text",{profileId:profile.id,name:"项目说明",content:material,relationship:"mine"});assert.equal(reused.reused,true);
  await library.close();const reopenedStore=await new ReplicaDataStore(x.directory).initialize();
  assert.equal(reopenedStore.state.personalLibrary.cards.filter(c=>c.status==="confirmed").length,1);
  const result=await retrieveWorkspaceKnowledge(index,reopenedStore,null,"检索模块",{mode:"fast",personalProfileId:profile.id});assert.ok(result.citations.length);
});

test("changed and removed sources cannot return stale cards, and profiles never cross-retrieve",async t=>{
  const x=await setup(t);const {library,profile,store,index}=x;
  const input={profileId:profile.id,name:"说明",identity:"text:stable",content:material,relationship:"mine"};
  const source=await library.dispatch("import-text",input);let job=await library.dispatch("distill",{profileId:profile.id});await terminal(library,job.jobId);
  const oldFiles=await readdir(join(x.directory,"personal-materials"));
  const other=await library.dispatch("save-profile",{name:"乙同学",targetRole:"市场营销"});
  const workspace=store.newWorkspace();store.state.workspaces.push(workspace);
  assert.equal(workspace.personalProfileId,other.id);
  assert.equal((await retrieveWorkspaceKnowledge(index,store,workspace.id,"二分查找",{mode:"fast"})).citations.length,0);
  // An interview keeps its captured profile even if another profile becomes active.
  assert.ok((await retrieveWorkspaceKnowledge(index,store,null,"二分查找",{mode:"fast",personalProfileId:profile.id})).citations.length);
  await library.dispatch("import-text",{...input,content:material.replace("有序数组","有序列表")});
  assert.equal((await retrieveWorkspaceKnowledge(index,store,null,"二分查找",{mode:"fast",personalProfileId:profile.id})).citations.length,0);
  const nextFiles=await readdir(join(x.directory,"personal-materials"));assert.equal(nextFiles.length,1);assert.notEqual(nextFiles[0],oldFiles[0]);
  await library.dispatch("remove-source",{profileId:profile.id,sourceId:source.id});assert.equal((await readdir(join(x.directory,"personal-materials"))).length,0);
});

test("invented quotes are rejected, full source is partitioned without dropping text",()=>{
  const source={id:"s",contentHash:"hash",relationship:"mixed",content:"甲".repeat(15000)};
  const batches=sourceBatches(source);assert.equal(batches.map(b=>b.content).join(""),source.content);assert.equal(batches.length,3);
  assert.throws(()=>normalizeKnowledgeCards({cards:[{title:"伪引用",summary:"事实",quote:"完全不存在于当前材料中的一句话。"}]},source,batches[0],"p"),/无法在原文中定位/);
  assert.throws(()=>normalizeKnowledgeCards("不是 JSON",source,batches[0],"p"),/有效的知识卡/);
  const cards=normalizeKnowledgeCards({cards:[{title:"个人职责",summary:"我负责模型训练",quote:"甲".repeat(20),kind:"knowledge"}]},source,batches[0],"p");
  assert.equal(cards[0].status,"needs_confirmation");
});

test("AI failure resumes after saved batches and a repeated run makes no additional AI calls",async t=>{
  let fail=true;
  const x=await setup(t,{complete:async(input,n)=>{if(n===2&&fail)throw Object.assign(Error("secret must not leak sk-hidden"),{code:"ai_unavailable"});const p=JSON.parse(input.messages.at(-1).content);return JSON.stringify({cards:[{title:"局部知识",summary:"材料中的技术说明",quote:p.material.slice(0,40),kind:"knowledge"}]});}});
  await x.library.dispatch("import-text",{profileId:x.profile.id,content:"知识说明。".repeat(1800)});
  const {jobId}=await x.library.dispatch("distill",{profileId:x.profile.id});let j=await terminal(x.library,jobId);assert.equal(j.status,"failed");assert.doesNotMatch(j.message,/sk-hidden/);
  assert.equal(x.library.snapshot().sources[0].processedBatches,1);fail=false;
  await x.library.dispatch("job-control",{jobId,control:"resume"});j=await terminal(x.library,jobId);assert.equal(j.status,"completed");assert.equal(x.calls(),3);
  const repeat=await x.library.dispatch("distill",{profileId:x.profile.id});await terminal(x.library,repeat.jobId);assert.equal(x.calls(),3);
});

test("folder and multi-file imports preserve unchanged hashes and retry without duplicate sources",async t=>{
  const x=await setup(t);const folder=join(x.directory,"documents");await mkdir(folder);await writeFile(join(folder,"notes.md"),material);await writeFile(join(folder,"paper.txt"),"研究内容：使用二分搜索缩小范围，并分析运行复杂度。");
  let j=await x.library.importFolder(x.profile.id,folder,"mixed");assert.equal((await terminal(x.library,j.jobId)).status,"completed");
  const first=x.library.snapshot().sources.map(s=>({id:s.id,version:s.version}));assert.equal(first.length,2);
  j=await x.library.importFolder(x.profile.id,folder,"mixed");await terminal(x.library,j.jobId);assert.deepEqual(x.library.snapshot().sources.map(s=>({id:s.id,version:s.version})),first);
  await writeFile(join(folder,"notes.md"),material+"\n补充：边界条件包括空数组和重复元素。");
  j=await x.library.importFolder(x.profile.id,folder,"mixed");await terminal(x.library,j.jobId);assert.equal(x.library.snapshot().sources.filter(s=>s.version===2).length,1);
  j=await x.library.importFiles(x.profile.id,[join(folder,"paper.txt")],"reference");assert.equal((await terminal(x.library,j.jobId)).status,"completed");
  const count=x.library.snapshot().sources.length;j=await x.library.importFiles(x.profile.id,[join(folder,"paper.txt")],"reference");await terminal(x.library,j.jobId);assert.equal(x.library.snapshot().sources.length,count);
});

test("interrupted jobs reopen paused and library HTTP operations require the local token",async t=>{
  const x=await setup(t);await x.store.update(()=>x.store.state.personalLibrary.jobs.push({id:"interrupted",profileId:x.profile.id,status:"running",kind:"distill"}));
  const reopened=createPersonalLibrary({store:x.store,knowledgeIndex:x.index,aiService:x.aiService});await reopened.initialize();t.after(()=>reopened.close());
  assert.equal(reopened.snapshot().jobs[0].status,"paused");
  const api=await startReplicaApiServer({port:0,store:x.store,knowledgeIndex:x.index,aiService:x.aiService,authToken:"library-test-token"});t.after(()=>api.close());
  const url=`http://127.0.0.1:${api.port}/api/personal-library/snapshot`;
  assert.equal((await fetch(url,{method:"POST",body:"{}"})).status,401);
  const response=await fetch(url,{method:"POST",headers:{Authorization:"Bearer library-test-token","Content-Type":"application/json"},body:"{}"});assert.equal(response.status,200);assert.equal((await response.json()).profile.name,"甲同学");
});

test("twenty-batch limit pauses and resumes only the remaining material",async t=>{
  const x=await setup(t,{complete:async()=>JSON.stringify({cards:[]})});
  await x.library.dispatch('import-text',{profileId:x.profile.id,content:'技术材料。'.repeat(27000)});
  const {jobId}=await x.library.dispatch('distill',{profileId:x.profile.id});
  assert.equal((await terminal(x.library,jobId)).status,'paused');assert.equal(x.calls(),20);
  assert.equal(x.library.snapshot().sources[0].processedBatches,20);
  await x.library.dispatch('job-control',{jobId,control:'resume'});
  assert.equal((await terminal(x.library,jobId)).status,'completed');assert.equal(x.calls(),21);
});

test("failed card reindex never serves the old summary and can repair without repeating AI",async t=>{
  const x=await setup(t);await x.library.dispatch('import-text',{profileId:x.profile.id,content:material});
  const {jobId}=await x.library.dispatch('distill',{profileId:x.profile.id});await terminal(x.library,jobId);
  const card=x.library.snapshot().cards.find(c=>c.kind==='knowledge');
  const original=x.index.indexTextDocument.bind(x.index);x.index.indexTextDocument=async()=>{throw Error('disk error');};
  await assert.rejects(()=>x.library.dispatch('review-card',{profileId:x.profile.id,cardId:card.id,status:'confirmed',summary:'二分查找适用于有序列表；注意左右边界的定义。'}),/disk error/);
  assert.equal((await x.library.dispatch('search',{profileId:x.profile.id,query:'二分查找'})).citations.length,0);
  assert.equal((await retrieveWorkspaceKnowledge(x.index,x.store,null,'二分查找',{mode:'fast',personalProfileId:x.profile.id})).citations.length,0);
  x.index.indexTextDocument=original;const retry=await x.library.dispatch('distill',{profileId:x.profile.id});await terminal(x.library,retry.jobId);
  assert.equal(x.calls(),1);const result=await x.library.dispatch('search',{profileId:x.profile.id,query:'二分查找'});
  assert.ok(result.citations.some(c=>c.snippet.includes('注意左右边界')));
});

test("identical content from another location reuses cards, while a changed copy stays independent",async t=>{
  const x=await setup(t);const first=await x.library.dispatch('import-text',{profileId:x.profile.id,identity:'text:first',content:material});
  const second=await x.library.dispatch('import-text',{profileId:x.profile.id,identity:'text:second',content:material});
  assert.equal(first.id,second.id);assert.equal(second.duplicate,true);assert.equal(x.library.snapshot().sources.length,1);
  await x.library.dispatch('import-text',{profileId:x.profile.id,identity:'text:second',content:material+'\n这份材料新增了一段独立说明。'});
  assert.equal(x.library.snapshot().sources.length,2);
  assert.equal((await x.library.dispatch('source',{profileId:x.profile.id,sourceId:first.id})).content,material);
});

test("reverting material content or changing ownership produces usable cards again",async t=>{
  const x=await setup(t);const input={profileId:x.profile.id,identity:'text:revert',content:material,relationship:'mixed'};
  async function importAndDistill(patch){await x.library.dispatch('import-text',{...input,...patch});const {jobId}=await x.library.dispatch('distill',{profileId:x.profile.id});assert.equal((await terminal(x.library,jobId)).status,'completed');}
  await importAndDistill({});await importAndDistill({content:material.replace('数组','列表')});await importAndDistill({});
  assert.equal(usablePersonalCards(x.store,x.profile.id).length,1);
  await importAndDistill({relationship:'reference'});
  assert.equal(usablePersonalCards(x.store,x.profile.id).length,1);assert.equal(usablePersonalCards(x.store,x.profile.id)[0].relationship,'reference');
  assert.equal(x.library.snapshot().cards.filter(c=>c.status==='needs_confirmation').length,1);
});

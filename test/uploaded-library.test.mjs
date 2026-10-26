import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {zipSync,strToU8} from 'fflate';
import {ReplicaDataStore} from '../out/main/local-api/data-store.mjs';
import {KnowledgeIndex} from '../out/main/knowledge/knowledge-index.mjs';
import {createPersonalLibrary} from '../out/main/knowledge/personal-library.mjs';
import {retrieveInterviewKnowledge} from '../out/main/local-api/server.mjs';
import {resolveConversationContext} from '../out/main/knowledge/conversation-context.mjs';

async function finish(library,jobId){for(let i=0;i<300;i++){const job=library.snapshot().jobs.find(j=>j.id===jobId);if(['completed','failed','paused','cancelled'].includes(job?.status)){assert.equal(job.status,'completed',job.message);return;}await delay(10);}throw Error('Import timed out');}

test('ordinary uploaded DOCX, PDF and code enter interview retrieval and changed files invalidate old facts',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'bluff-synthetic-upload-'));
  const folder=join(directory,'samples');await mkdir(folder);
  const store=await new ReplicaDataStore(join(directory,'state')).initialize();
  let calls=0;
  const aiService={embed:async texts=>({model:'synthetic',vectors:texts.map(()=>[1,0.1])}),complete:async input=>{
    calls++;const {material}=JSON.parse(input.messages.at(-1).content);const quote=material.trim().slice(0,650);
    return JSON.stringify({cards:[{title:'示例队列项目资料',summary:quote,quote,kind:'knowledge',question:'介绍示例队列项目的重试策略',tags:['示例队列','重试']}]});
  }};
  const index=await new KnowledgeIndex({filePath:join(directory,'index.json'),aiService}).initialize();
  const library=createPersonalLibrary({store,knowledgeIndex:index,aiService});await library.initialize();t.after(()=>library.close());
  const profile=await library.dispatch('save-profile',{name:'Synthetic candidate'});
  const resume=join(folder,'resume.docx'),paper=join(folder,'paper.pdf'),code=join(folder,'retry.js');
  await writeFile(resume,zipSync({'word/document.xml':strToU8('<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>示例简历：示例队列项目采用可配置重试策略。</w:t></w:r></w:p></w:body></w:document>')}));
  await writeFile(paper,makeMinimalPdf('Queue demonstration paper explains retry scheduling and failure handling.'));
  await writeFile(code,'// 示例队列项目：LEGACY_RETRY_POLICY 固定等待后重试。\nexport const retryDelay = 100;');
  await finish(library,(await library.importFiles(profile.id,[resume,paper,code],'reference')).jobId);
  assert.equal(library.snapshot().sources.length,3);assert.equal(calls,0,'importing itself must not invoke a cloud model');
  const first=library.snapshot().sources.map(s=>({id:s.id,version:s.version}));
  await finish(library,(await library.importFiles(profile.id,[resume,paper,code],'reference')).jobId);
  assert.deepEqual(library.snapshot().sources.map(s=>({id:s.id,version:s.version})),first);
  await finish(library,(await library.dispatch('distill',{profileId:profile.id})).jobId);
  assert.equal(calls,3);assert.equal(library.snapshot().cards.length,3);
  assert.ok(library.snapshot().cards.every(c=>!c.project),'ordinary cards do not require a bundled project catalog');
  const interview={personalProfileId:profile.id,answers:[]};
  let result=await retrieveInterviewKnowledge(index,store,interview,'介绍示例队列项目的重试策略',{mode:'fast'});
  assert.equal(result.conversationContext.generalKnowledge,false);
  assert.ok(result.citations.some(c=>c.snippet.includes('LEGACY_RETRY_POLICY')));
  assert.ok(library.snapshot().cards.some(c=>c.summary.includes('Queue demonstration paper')));
  assert.ok(library.snapshot().cards.some(c=>c.summary.includes('示例简历')));
  await writeFile(code,'// 示例队列项目：UPDATED_RETRY_POLICY 使用指数退避重试。\nexport const retryDelay = attempt => 100 * 2 ** attempt;');
  await finish(library,(await library.importFiles(profile.id,[code],'reference')).jobId);
  assert.equal(library.snapshot().sources.length,3);
  result=await retrieveInterviewKnowledge(index,store,interview,'介绍示例队列项目的重试策略',{mode:'fast'});
  assert.ok(!result.citations.some(c=>c.snippet.includes('LEGACY_RETRY_POLICY')));
  await finish(library,(await library.dispatch('distill',{profileId:profile.id})).jobId);
  assert.equal(calls,4,'only the changed source is distilled again');
  result=await retrieveInterviewKnowledge(index,store,interview,'介绍示例队列项目的重试策略',{mode:'fast'});
  assert.ok(result.citations.some(c=>c.snippet.includes('UPDATED_RETRY_POLICY')));
  const generic=await retrieveInterviewKnowledge(index,store,interview,'链表和数组有什么区别？',{mode:'fast'});
  assert.equal(generic.conversationContext.generalKnowledge,true);assert.equal(generic.citations.length,0);
});

test('unlabeled materials preserve project questions while unrelated theory drops old context',()=>{
  assert.equal(resolveConversationContext('介绍一下这个项目',{},[undefined]).generalKnowledge,false);
  assert.equal(resolveConversationContext('这篇论文解决什么问题？',{},[undefined]).generalKnowledge,false);
  assert.equal(resolveConversationContext('链表是什么？',{},[undefined]).generalKnowledge,true);
  assert.deepEqual(resolveConversationContext('Redis为什么快？',{answers:[{role:'user',content:'介绍示例项目'}]},['示例项目']).projects,[]);
});

function makeMinimalPdf(text) {
  const stream = `BT /F1 16 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDisplayName,validateReviewPatch,buildInterviewArchive,registerInterviewWorkflowIpc} from '../out/main/interview-workflow.mjs';
import {resolveConversationContext,mergeProjectRetrieval,asksPersonalContribution} from '../out/main/knowledge/conversation-context.mjs';
import {renderGroundedSelection} from '../out/main/knowledge/grounded-project-answer.mjs';
const projects=['DemoAlpha','DemoBeta','DemoGamma','DemoDelta','DemoEpsilon'];

test('one reviewed comparison card can cover both projects without unrelated filler',()=>{
 const source={id:0,project:'DemoZeta',question:'DemoZeta和DemoEpsilon分别做什么？',evidenceId:'comparison',sentences:['DemoZeta生产演示，DemoEpsilon学习策略。'],spokenAnswers:{quick:'DemoZeta生产演示，DemoEpsilon学习策略。',standard:'DemoZeta生产演示，DemoEpsilon学习策略。',deep:'DemoZeta生产演示，DemoEpsilon学习策略。'}};
 const selection=JSON.stringify({selections:[{card:0,sentences:[0],answerMode:'quick'}]});
 assert.equal(renderGroundedSelection(selection,[source],['DemoZeta','DemoEpsilon'],{answerLength:'quick'}).text,source.spokenAnswers.quick);
 assert.throws(()=>renderGroundedSelection(selection,[{...source,spokenAnswers:{...source.spokenAnswers,quick:'只说仿真演示的生产。'}}],['DemoZeta','DemoEpsilon']),/omitted/);
 assert.throws(()=>renderGroundedSelection(selection,[{...source,question:'DemoZeta是什么？'}],['DemoZeta','DemoEpsilon']),/omitted/);
});
test('project renderer emits only validated source sentences, retains boundaries and requires both comparison sides',()=>{
 const sources=[{id:0,project:'a',evidenceId:'a1',sentences:['源码使用词法检索。','没有向量。','不能据此认定个人贡献。']},{id:1,project:'b',evidenceId:'b1',sentences:['论文使用固定规则。']}];
 const answer=renderGroundedSelection(JSON.stringify({selections:[{card:0,sentences:[0]},{card:1,sentences:[0]}],invented:'我独立写了所有函数'}),sources,['a','b']);
 assert.match(answer.text,/不能据此认定个人贡献/);assert.doesNotMatch(answer.text,/独立写/);assert.deepEqual(answer.evidenceIds,['a1','b1']);
 assert.throws(()=>renderGroundedSelection('{"selections":[{"card":0,"sentences":[99]}]}',sources,['a']));
 assert.throws(()=>renderGroundedSelection('{"selections":[{"card":0,"sentences":[0]}]}',sources,['a','b']));
});
test('plain-language mode shows one complete card without repeating a second overview',()=>{
 const sources=[{id:0,project:'a',evidenceId:'a1',sentences:['给科研人员整理工作成果。','具体条件要保留。']},{id:1,project:'a',evidenceId:'a2',sentences:['重复的系统介绍。']}];
 const result=renderGroundedSelection('{"selections":[{"card":0,"sentences":[0]},{"card":1,"sentences":[0]}]}',sources,['a'],{maxCardsPerProject:1});
 assert.match(result.text,/具体条件要保留/);assert.doesNotMatch(result.text,/重复的系统介绍/);
});
test('follow-up resolves prior user project, cross-project keeps both, new topic resets',()=>{
 const i={answers:[{role:'user',content:'DemoGamma怎么处理视频？'},{role:'assistant',content:'DemoDelta是错误模型输出，不应锚定'}]};
 assert.deepEqual(resolveConversationContext('那它的速度呢？',i,projects).projects,['DemoGamma']);
 assert.deepEqual(resolveConversationContext('和DemoAlpha比有什么区别？',i,projects).projects,['DemoAlpha','DemoGamma']);
 assert.deepEqual(resolveConversationContext('DemoDelta支持OCR吗？',i,projects).projects,['DemoDelta']);
 assert.deepEqual(resolveConversationContext('八股：TCP为什么三次握手？',i,projects).projects,[]);
 const alg={answers:[{role:'user',content:'LeetCode两数之和'}]};
 assert.equal(resolveConversationContext('刚才的代码遇到重复下标怎么办？',alg,projects).questionType,'algorithm');
 assert.equal(resolveConversationContext('DemoBeta怎么发布？',{},projects).projects[0],'DemoBeta');
});
test('cross-project merge balances independent evidence and deduplicates chunks',()=>{
 const c=(id,project)=>({documentId:id,curatedAnswer:{project}});
 const result=mergeProjectRetrieval([{citations:[c('a','DemoBeta'),c('a','DemoBeta'),c('b','DemoBeta'),c('noise','DemoGamma')]},{citations:[c('c','DemoDelta'),c('d','DemoDelta')]}],['DemoBeta','DemoDelta'],4);
 assert.deepEqual(result.citations.map(c=>c.documentId),['a','c','b','d']);
});
test('dedup keeps the verified answer chunk rather than the earlier title-only chunk',()=>{
 const title={documentId:'a',documentName:'DemoBeta · 口语讲解',title:'标题'};
 const answer={...title,curatedAnswer:{project:'DemoBeta',answer:'已有证据的完整答案'}};
 const result=mergeProjectRetrieval([{citations:[title,answer]}],['DemoBeta'],12);
 assert.equal(result.citations.length,1);assert.equal(result.citations[0].curatedAnswer.answer,answer.curatedAnswer.answer);
});
test('HR paraphrases retain profile context and route actual work to contribution evidence',()=>{
 const i={answers:[{role:'user',content:'你的简历项目挺多。先不讲术语，它们有什么共同点，哪个最能代表你的能力？'}]};
 const q='如果面试官说这些看起来都是团队成果，你怎么讲清自己真正做过的事？';
 assert.deepEqual(resolveConversationContext(q,i,[...projects,'profile']).projects,['profile']);assert.ok(asksPersonalContribution(q));
 assert.ok(asksPersonalContribution('简历写核心参与，我能据此认为整个系统架构都是你一个人设计的吗？'));
 assert.deepEqual(resolveConversationContext('那些结果里，哪些是你动手完成的？',i,[...projects,'profile']).projects,['profile']);
 assert.deepEqual(resolveConversationContext('八股题TCP的重传怎么做？',i,[...projects,'profile']).projects,[]);
 assert.deepEqual(resolveConversationContext('你做的这些系统，最后想帮用户把哪件事情做成？',{},[...projects,'profile']).projects,['profile']);
 assert.ok(asksPersonalContribution('只允许你讲自己真正动过手的两件事，你会怎么界定？'));
 assert.equal(resolveConversationContext('未能识别的问法',{},[...projects,'profile']).generalKnowledge,true);
});
test('record updates reject invalid identity and archive preserves failed attempts and revisions',()=>{
 assert.equal(validateDisplayName(' 小陈 '),'小陈');
 for(const value of ['',null,'x'.repeat(61),'name\n'])assert.throws(()=>validateDisplayName(value));
 assert.throws(()=>validateReviewPatch({title:''}));assert.throws(()=>validateReviewPatch({reviewNotes:'a'.repeat(30001)}));
 assert.deepEqual(validateReviewPatch({title:'研发一面',role:'admin'}),{title:'研发一面'});
 const archive=buildInterviewArchive({title:'一面',transcripts:[{content:'最终词',revisions:[{content:'初始词'}],createdAt:'2026-10-25T00:01:00Z'}],answerAttempts:[{question:'网络？',status:'failed',partialText:'部分',createdAt:'2026-10-25T00:02:00Z'}]});
 assert.equal(archive.record.transcripts[0].revisions[0].content,'初始词');assert.equal(archive.timeline[1].kind,'incomplete_answer');
});
test('review transfer is idempotent, scoped, preserves unanswered questions without promoting AI facts',async()=>{
 let call;const frame={processId:1,routingId:1,url:'cheater://localhost/#/interviews/i'};const event={senderFrame:frame,sender:{mainFrame:frame}};
 const store={state:{user:{name:'本地用户'},personalLibrary:{profiles:[{id:'p'}]},interviews:[{id:'i',personalProfileId:'p',title:'一面',answers:[{role:'assistant',content:'我独立实现一切'}],answerAttempts:[{question:'失败的问题',status:'failed'}],reviewNotes:'待确认'}]},update:async f=>f(store.state)};
 registerInterviewWorkflowIpc({ipcMain:{handle:(_c,f)=>call=f},BrowserWindow:{fromWebContents:()=>({isDestroyed:()=>false})},dialog:{},store});
 await call(event,'save-account',{name:'小陈'});assert.equal(store.state.user.name,'小陈');
 await call(event,'save-record',{interviewId:'i',title:'研发二面'});
 await call(event,'review-to-library',{interviewId:'i'});await call(event,'review-to-library',{interviewId:'i'});
 assert.equal(store.state.personalLibrary.feedback.length,1);const f=store.state.personalLibrary.feedback[0];assert.equal(f.profileId,'p');assert.equal(f.questions,'失败的问题');assert.equal(f.status,'recorded_not_facts');assert.doesNotMatch(JSON.stringify(f),/独立实现/);
 await assert.rejects(()=>call({...event,senderFrame:{...frame,url:'https://example.com'}},'account'),/无权/);
});

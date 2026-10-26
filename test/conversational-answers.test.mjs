import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyInterviewQuestion,buildRealtimeSystemPrompt} from '../out/main/prompts/realtime.mjs';
import {guardModelSelfClaims} from '../out/main/knowledge/answer-style.mjs';
import {phraseGroundedAnswer} from '../out/main/knowledge/spoken-project-answer.mjs';

test('concept questions never trigger coding, system design or behavioral templates by keyword',()=>{
  for(const q of ['你怎么理解链表？和数组相比有什么优缺点？','Redis为什么快？缓存穿透怎么办？','二叉树是什么？','讲讲排序算法的区别。'])assert.equal(classifyInterviewQuestion(q),'technical',q);
  assert.equal(classifyInterviewQuestion('请写代码反转链表，分析复杂度。'),'algorithm');
  assert.equal(classifyInterviewQuestion('请设计一个分布式缓存系统。'),'system_design');
});
test('a blocked biography claim never invents a lack of experience in a theory answer',()=>{
  const text=guardModelSelfClaims('我熟悉链表。链表用指针连接节点。');
  assert.equal(text,'链表用指针连接节点。');
  assert.doesNotMatch(text,/没.*实操|愿意学|未确认/);
  assert.match(guardModelSelfClaims('我的理解是，用指针把节点连接起来。'),/我的理解是/);
  const prompt=buildRealtimeSystemPrompt('zh-CN','technical','',{generalKnowledge:true});
  assert.match(prompt,/没有要求代码就不主动给代码/);
  assert.doesNotMatch(prompt,/只给条件式示例|算法题必须先/);
});
const original={text:'该系统持久化表格结果，使后续SQL会话可继续查询。',evidenceIds:['e1'],source:'grounded_project_selection'};
function api(answers,valid){let i=0;return {complete:async()=>JSON.stringify(i++?{valid}:{answers})};}
test('spoken project rewrite explains actions without changing the stored evidence or ids',async()=>{
  const before=structuredClone(original);
  const result=await phraseGroundedAnswer({aiService:api(['它把上次算出的表保存下来，下次接着查。'],[true]),question:'这个项目有什么用？',answer:original});
  assert.equal(result.text,'它把上次算出的表保存下来，下次接着查。');
  assert.deepEqual(result.evidenceIds,['e1']);assert.deepEqual(original,before);
});
test('unsupported personal action, negative review or missing subquestion falls back intact',async()=>{
  for(const service of [api(['我实现了这个系统。'],[true]),api(['它自动提升了准确率。'],[false]),api([],[true])]){
    assert.equal((await phraseGroundedAnswer({aiService:service,question:'它是什么？',answer:original})).text,original.text);
  }
  const multi={...original,parts:[{question:'保存什么？',text:original.text},{question:'我负责什么？',text:'具体模块归属尚未确认。'}]};
  assert.equal((await phraseGroundedAnswer({aiService:api(['只说表格。'],[true]),question:'两问',answer:multi})).text,multi.text);
});
test('spoken rewrite propagates cancellation instead of silently publishing stale text',async()=>{
  const controller=new AbortController();const aiService={complete:async()=>{controller.abort();throw Error('aborted');}};
  await assert.rejects(phraseGroundedAnswer({aiService,question:'用途？',answer:original,signal:controller.signal}),/aborted/);
});
import {splitQuestionParts} from '../out/main/knowledge/question-parts.mjs';
test('requests for plainer wording are attached to the factual question',()=>{assert.equal(splitQuestionParts('数据助手有什么用？能讲得好懂一点吗？').length,1);assert.equal(splitQuestionParts('Reviewer能写代码吗？谁负责这一块？').length,2);});
test('skill guard catches a subjectless learning history after a truthful denial',()=>{const text=guardModelSelfClaims('还没在生产环境用过，但已开始系统学习核心概念。后续打算搭个测试环境。',{skillExperience:true});assert.doesNotMatch(text,/已开始系统学习/);assert.match(text,/后续打算/);});

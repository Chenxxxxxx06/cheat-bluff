import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AiSettingsStore} from '../out/main/ai-settings.mjs';
import {searchRecords,discoverRecord} from '../out/main/record-discovery.mjs';
import {validateReviewPatch} from '../out/main/interview-workflow.mjs';
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('protected:'+s),decryptString:b=>b.toString().replace(/^protected:/,'')};
test('independent providers preserve existing credentials; new providers never inherit secrets; switching survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bluff-provider-'));const filePath=join(dir,'settings.json');let store=await new AiSettingsStore({filePath,safeStorage}).initialize();
 const original=await store.save({profileName:'My Qwen',apiKey:'first-private-key',textModel:'qwen-plus'});
 const next=await store.save({profileAction:'create'});assert.equal(next.hasApiKey,false);assert.equal(next.connectionProfiles.length,2);
 const custom=await store.save({profileName:'Local custom',baseUrl:'http://127.0.0.1:3000/v1',textModel:'test-model',apiKey:'second-private-key',asrApiKey:'speech-private-key'});
 assert.equal(store.getCredentials().apiKey,'second-private-key');assert.equal(store.getAsrCredentials().asrApiKey,'speech-private-key');
 store=await new AiSettingsStore({filePath,safeStorage}).initialize();assert.equal(store.getPublicSettings().activeProfileId,custom.activeProfileId);assert.equal(store.getAsrCredentials().asrApiKey,'speech-private-key');
 await store.save({profileAction:'activate',profileId:original.activeProfileId});assert.equal(store.getCredentials().apiKey,'first-private-key');assert.equal(store.getCredentials().textModel,'qwen-plus');assert.equal(store.getAsrCredentials().asrApiKey,'first-private-key');
 assert.doesNotMatch(JSON.stringify(store.getPublicSettings()),/private-key|encryptedApiKey/);assert.doesNotMatch(await readFile(filePath,'utf8'),/first-private-key|second-private-key|speech-private-key/);
 await store.save({profileAction:'remove',profileId:custom.activeProfileId});assert.equal(store.getPublicSettings().connectionProfiles.length,1);assert.equal(store.getCredentials().apiKey,'first-private-key');
 await assert.rejects(store.save({profileAction:'remove',profileId:original.activeProfileId}));
});
test('record search includes transcript, title, editable metadata and date across all pages, never deleted records',()=>{
 const rows=Array.from({length:65},(_,i)=>({id:String(i),title:`面试${i}`,startAt:`2026-10-${String(1+i%25).padStart(2,'0')}T01:00:00Z`,transcripts:[]}));
 rows[64].company='Example';rows[64].jobRole='算法实习';rows[64].transcripts=[{content:'讲讲 RAG 与 Redis 缓存'}];
 assert.equal(searchRecords(rows,[],'example RAG').total,1);assert.equal(searchRecords(rows,[],'算法实习').records[0].id,'64');
 assert.ok(searchRecords(rows,[],'2026-10').total===65);assert.equal(searchRecords(rows,[],'',60).records.length,5);
 assert.deepEqual(discoverRecord(rows[64]).keywords,['RAG','Redis','算法']);rows[64].deletedAt='today';assert.equal(searchRecords(rows,[],'Redis').total,0);
});
test('metadata validation keeps position separate from permission role, bounds keyword inputs',()=>{
 assert.deepEqual(validateReviewPatch({role:'admin',jobRole:'算法',company:'企业',keywords:['RAG',' RAG ']}),{jobRole:'算法',company:'企业',keywords:['RAG']});
 assert.throws(()=>validateReviewPatch({keywords:Array(13).fill('test')}));assert.throws(()=>validateReviewPatch({company:'a'.repeat(101)}));
});

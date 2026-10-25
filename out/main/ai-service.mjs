import { AiServiceError, createQwenAiService } from './qwen-ai-service.mjs';
export function createAiService(settingsStore, options={}) {
 const service=options.qwenService??createQwenAiService(settingsStore,options.qwen);
 return {async complete(input={}){const answer=await service.complete(input);if(typeof answer!=='string'||!answer.trim())throw new AiServiceError('模型返回了空内容。',{code:'ai_empty_response'});return answer;},embed:(...args)=>service.embed(...args),testConnection:()=>service.testConnection(),testVisionConnection:()=>service.testVisionConnection(),testFastConnection:()=>service.testConnection(),testFastVisionConnection:()=>service.testVisionConnection(),warmup:()=>Promise.resolve(),dispose:()=>{},getRuntimeConfig:()=>service.getRuntimeConfig()};
}

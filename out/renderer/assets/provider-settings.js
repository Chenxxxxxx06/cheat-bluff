// Original connection editor · undestand. Inspired by independently switchable provider profiles.
export function createProviderSettings({React,Button,Select}){
 const h=React.createElement;
 return function ProviderSettings(){
  const [data,setData]=React.useState(null),[key,setKey]=React.useState(''),[speechKey,setSpeechKey]=React.useState(''),[busy,setBusy]=React.useState(false),[message,setMessage]=React.useState(''),[removing,setRemoving]=React.useState(false);
  React.useEffect(()=>{let live=true;window.api.aiSettings.get().then(x=>live&&setData(x)).catch(e=>live&&setMessage(e.message));return()=>{live=false;};},[]);
  async function run(action){setBusy(true);setMessage('');try{await action();}catch(e){setMessage(e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{setBusy(false);}}
  async function update(input){const result=await window.api.aiSettings.save(input);setData(result);setKey('');setSpeechKey('');setRemoving(false);window.dispatchEvent(new Event('cheater-ai-settings-changed'));return result;}
  async function save(test=false){await update({...data,connectionProfiles:undefined,apiKey:key,asrApiKey:speechKey,provider:data.provider});if(test){const result=await window.api.aiSettings.testConnection();setMessage(result.message);}else setMessage('连接已保存。');}
  const field=(name,label,{type='text',wide=false,placeholder=''}={})=>h('label',{className:wide?'cb-wide':''},h('span',null,label),h('input',{type,value:data[name]??'',placeholder,disabled:busy,onChange:e=>setData(x=>({...x,[name]:type==='number'?Number(e.target.value):e.target.value})),spellCheck:false}));
  const button=(label,fn,variant='outline')=>h(Button,{size:'sm',variant,disabled:busy,onClick:()=>run(fn)},label);
  if(!data)return h('p',{role:'status'},message||'正在读取连接…');
  return h('section',{className:'space-y-4 rounded-xl border p-5','data-testid':'provider-settings'},
   h('div',{className:'cb-provider-header'},h('h3',{className:'text-ui-title'},'模型连接'),button('添加连接',()=>update({profileAction:'create'}))),
   h('label',{className:'block space-y-2'},h('span',{className:'text-ui'},'当前连接'),h(Select,{'aria-label':'当前连接',value:data.activeProfileId??'current',disabled:busy,onChange:e=>run(()=>update({profileAction:'activate',profileId:e.target.value}))},data.connectionProfiles?.length?data.connectionProfiles.map(p=>h('option',{key:p.id,value:p.id},p.name)):h('option',{value:'current'},data.profileName))),
   h('div',{className:'cb-provider-fields'},field('profileName','连接名称'),h('label',null,h('span',null,'接口类型'),h(Select,{'aria-label':'接口类型',value:data.provider,disabled:busy,onChange:e=>setData(x=>({...x,provider:e.target.value}))},h('option',{value:'qwen'},'阿里云百炼'),h('option',{value:'custom'},'自定义 · OpenAI 兼容'))),
    field('baseUrl','API 地址（Base URL）',{wide:true,placeholder:'https://api.example.com/v1'}),
    h('label',{className:'cb-wide'},h('span',null,'API Key'),h('input',{type:'password',value:key,disabled:busy,autoComplete:'off',onChange:e=>setKey(e.target.value),placeholder:data.hasApiKey?'已加密保存；留空保留':'输入你的服务商密钥'})),
    field('textModel','回答模型'),field('visionModel','图片模型'),field('embeddingModel','Embedding 模型')),
   h('p',{className:'cb-provider-note'},'支持 OpenAI Chat Completions 兼容接口。回答、图片和检索共用此连接；模型名称请填写服务商提供的名称。密钥只加密保存在本机。'),
   h('details',null,h('summary',{className:'cursor-pointer text-ui'},'语音与响应设置'),h('div',{className:'cb-provider-fields mt-4'},field('asrUrl','实时语音地址（DashScope 协议）',{wide:true}),field('asrModel','语音模型'),data.provider==='custom'&&h('label',null,h('span',null,'语音密钥（可选）'),h('input',{type:'password',value:speechKey,disabled:busy,autoComplete:'off',onChange:e=>setSpeechKey(e.target.value),placeholder:data.hasSeparateAsrApiKey?'已单独保存；留空保留':'留空使用主连接密钥'})),field('maxAnswerTokens','回答 Token 上限',{type:'number'}),field('autoAnswerCooldownMs','自动回答间隔（毫秒）',{type:'number'})),h('p',{className:'cb-provider-note mt-3'},'实时转写使用 DashScope WebSocket 协议，并非所有 OpenAI 兼容服务都支持。可单独配置百炼语音密钥；测试会分别显示各项结果。'),data.hasSeparateAsrApiKey&&button('语音改用主密钥',()=>update({clearAsrKey:true}))),
   h('div',{className:'flex flex-wrap gap-2'},button(busy?'处理中…':'保存连接',()=>save(),'default'),button('保存并测试',()=>save(true)),data.hasApiKey&&button('清除密钥',async()=>{setData(await window.api.aiSettings.clearApiKey());window.dispatchEvent(new Event('cheater-ai-settings-changed'));setMessage('当前连接密钥已清除。');})),
   message&&h('p',{role:'status',className:'text-ui'},message),
   data.connectionProfiles?.length>1&&h('div',{className:'border-t pt-3'},removing?h('div',{className:'flex items-center gap-3'},h('span',{className:'text-ui'},'删除这个连接及其密钥？'),button('确认删除',()=>update({profileAction:'remove',profileId:data.activeProfileId})),h('button',{disabled:busy,onClick:()=>setRemoving(false)},'取消')):h('button',{className:'text-sm text-muted-foreground',disabled:busy,onClick:()=>setRemoving(true)},'删除当前连接')));
 };
}

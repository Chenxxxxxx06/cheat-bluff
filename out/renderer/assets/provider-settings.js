// Original settings interface · undestand.
export function createProviderSettings({React, Button, Select}) {
  const h = React.createElement;
  return function ProviderSettings() {
    const [data,setData]=React.useState(null),[key,setKey]=React.useState(''),[speechKey,setSpeechKey]=React.useState('');
    const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState(''),[error,setError]=React.useState(false),[removing,setRemoving]=React.useState(false),[clearing,setClearing]=React.useState(false);
    React.useEffect(()=>{let live=true;window.api.aiSettings.get().then(x=>live&&setData(x)).catch(e=>{if(live){setError(true);setMessage(e.message);}});return()=>{live=false;};},[]);
    async function run(action){setBusy(true);setMessage('');setError(false);try{await action();}catch(e){setError(true);setMessage(String(e.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{setBusy(false);}}
    async function update(input){const result=await window.api.aiSettings.save(input);setData(result);setKey('');setSpeechKey('');setRemoving(false);setClearing(false);window.dispatchEvent(new Event('cheater-ai-settings-changed'));return result;}
    async function save(test=false){await update({...data,connectionProfiles:undefined,apiKey:key,asrApiKey:speechKey,provider:data.provider});if(test){const result=await window.api.aiSettings.testConnection();setMessage(result.message);}else setMessage('已保存');}
    const button=(label,fn,style='secondary')=>h(Button,{type:'button',size:'sm',variant:style==='primary'?'default':'ghost',className:`as-button as-${style}`,disabled:busy,onClick:()=>run(fn)},label);
    const row=(label,control,hint)=>h('label',{className:'as-row'},h('span',{className:'as-label'},label,hint&&h('small',null,hint)),h('span',{className:'as-control'},control));
    const field=(name,label,{type='text',placeholder='',hint}={})=>row(label,h('input',{'aria-label':label,type,value:data[name]??'',placeholder,disabled:busy,onChange:e=>setData(x=>({...x,[name]:type==='number'?Number(e.target.value):e.target.value})),spellCheck:false}),hint);
    const group=(title,children,note)=>h('div',{className:'as-group'},h('h4',null,title),h('div',{className:'as-group-body'},children),note&&h('p',{className:'as-note'},note));
    if(!data)return h('p',{role:error?'alert':'status'},message||'正在读取连接…');
    const profiles=data.connectionProfiles?.length?data.connectionProfiles:[{id:'current',name:data.profileName||'当前连接'}];
    return h('section',{className:'apple-settings','data-testid':'provider-settings','aria-busy':busy},
      h('header',{className:'as-header'},h('span',{className:'as-symbol','aria-hidden':true},h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8},h('path',{d:'M10 13a5 5 0 0 0 7 .4l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.4l-3 3a5 5 0 0 0 7 7l2-2'}))),h('div',null,h('h3',null,'模型连接'),h('p',null,'连接自己的模型，开始准备。'))),
      group('连接',[
        row('使用连接',h('div',{className:'as-profile-picker'},h(Select,{'aria-label':'当前连接',value:data.activeProfileId??'current',disabled:busy,onChange:e=>run(()=>update({profileAction:'activate',profileId:e.target.value}))},profiles.map(p=>h('option',{key:p.id,value:p.id},p.name))),button('添加',()=>update({profileAction:'create'}),'link'))),
        field('profileName','连接名称'),
        row('服务商',h(Select,{'aria-label':'接口类型',value:data.provider,disabled:busy,onChange:e=>setData(x=>({...x,provider:e.target.value}))},h('option',{value:'qwen'},'阿里云百炼'),h('option',{value:'custom'},'自定义 · OpenAI 兼容'))),
        field('baseUrl','服务地址',{placeholder:'https://api.example.com/v1',hint:'Base URL'}),
        row('密钥',h('input',{'aria-label':'API Key',type:'password',value:key,disabled:busy,autoComplete:'off',spellCheck:false,onChange:e=>setKey(e.target.value),placeholder:data.hasApiKey?'已保存 · 留空保持不变':'输入服务商提供的 API Key'})),
      ],'密钥加密保存在本机。使用 AI 时，相关材料会发送至你选择的服务。'),
      group('模型',[
        field('textModel','回答',{placeholder:'模型名称'}),field('visionModel','图片理解',{placeholder:'支持图片的模型名称'}),field('embeddingModel','知识检索',{placeholder:'Embedding 模型名称'}),
      ],'填写服务商提供的模型名称，三项共用上方连接。'),
      h('details',{className:'as-advanced'},h('summary',null,h('span',null,'语音与高级设置'),h('span',{'aria-hidden':true,className:'as-chevron'},'›')),
        group('实时语音',[
          field('asrUrl','语音地址',{hint:'DashScope WebSocket'}),field('asrModel','语音模型'),
          data.provider==='custom'&&row('语音密钥',h('input',{'aria-label':'语音密钥',type:'password',value:speechKey,disabled:busy,autoComplete:'off',onChange:e=>setSpeechKey(e.target.value),placeholder:data.hasSeparateAsrApiKey?'已保存 · 留空保持不变':'可选 · 留空使用主密钥'})),
        ],'实时转写需要兼容 DashScope 的服务，可单独配置语音密钥。'),
        data.hasSeparateAsrApiKey&&button('语音改用主密钥',()=>update({clearAsrKey:true}),'link'),
        group('回答', [field('maxAnswerTokens','Token 上限',{type:'number'}),field('autoAnswerCooldownMs','自动回答间隔',{type:'number',hint:'毫秒'})])),
      message&&h('p',{role:error?'alert':'status',className:`as-status${error?' as-error':''}`},message),
      h('footer',{className:'as-footer'},h('span',{className:'as-secure'},data.hasApiKey?'密钥已加密保存':'尚未设置密钥'),h('div',{className:'as-actions'},button('保存并测试',()=>save(true)),button(busy?'处理中…':'保存',()=>save(),'primary'))),
      (data.hasApiKey||profiles.length>1)&&h('details',{className:'as-maintenance'},h('summary',null,'管理此连接'),h('div',{className:'as-maintenance-actions'},
        data.hasApiKey&&(clearing?h('div',{className:'as-confirm'},h('span',null,'清除此连接的密钥？'),button('确认清除',async()=>{setData(await window.api.aiSettings.clearApiKey());setClearing(false);window.dispatchEvent(new Event('cheater-ai-settings-changed'));setMessage('密钥已清除');},'danger'),button('取消',async()=>setClearing(false),'link')):button('清除密钥',async()=>setClearing(true),'danger')),
        profiles.length>1&&(removing?h('div',{className:'as-confirm'},h('span',null,'删除此连接及密钥？'),button('确认删除',()=>update({profileAction:'remove',profileId:data.activeProfileId}),'danger'),button('取消',async()=>setRemoving(false),'link')):button('删除连接',async()=>setRemoving(true),'danger')))));
  };
}

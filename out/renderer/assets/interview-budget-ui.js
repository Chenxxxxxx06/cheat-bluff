const compactNumber = value => value.toLocaleString('zh-CN', {maximumFractionDigits: value < 1 ? 2 : 1});
export function formatInterviewHours(estimate) {
  if (estimate?.status !== 'ready') return '—';
  if (estimate.hoursHigh === 0) return '0 小时';
  if (estimate.hoursHigh < 0.01) return '不足 1 分钟';
  const low = compactNumber(estimate.hoursLow), high = compactNumber(estimate.hoursHigh);
  return `${low === high ? low : `${low}–${high}`} 小时`;
}
export function budgetPresentation(state) {
  const b = state?.balance;
  return {
    balance: b?.amount == null ? '未同步' : `¥${b.amount.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
    source: b?.source === 'manual' ? '手动录入的余额' : b?.source === 'aliyun' ? '阿里云账户现金余额' : '账户余额',
    hours: formatInterviewHours(state?.estimate),
    updated: b?.updatedAt ? `${b.source === 'manual' ? '录入' : '同步'}于 ${new Date(b.updatedAt).toLocaleString('zh-CN', {hour12: false})}${b.stale ? ' · 快照较旧，请更新' : ''}` : '填写控制台余额即可估算，无需新增密钥。',
  };
}

export function createInterviewBudgetViews({React, Button, Select="select", invoke: providedInvoke}) {
  const h = React.createElement;
  const invoke = providedInvoke ?? ((action, input = {}) => window.api.interviewBudget.invoke(action, input));
  const cleanError = error => error?.message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || '预算操作失败，请重试。';
  const numericFields = [
    ['asrStreams', '同时上传语音路数', 0, 2, 1], ['asrMinutesPerHour', '每路每小时上传分钟', 0, 60, 1],
    ['questionsPerHourLow', '每小时文字问题下限', 0, 600, 1], ['questionsPerHourHigh', '每小时文字问题上限', 0, 600, 1],
    ['localCardPercent', '本地卡直接展示占比（%）', 0, 100, 1],
    ['textInputTokensLow', '每个付费问题累计输入 token 下限', 1, 1000000, 1], ['textInputTokensHigh', '每个付费问题累计输入 token 上限', 1, 1000000, 1],
    ['textOutputTokensLow', '每个付费问题累计输出 token 下限', 1, 100000, 1], ['textOutputTokensHigh', '每个付费问题累计输出 token 上限', 1, 100000, 1],
    ['visionCallsPerHourLow', '每小时截图提问下限', 0, 600, 1], ['visionCallsPerHourHigh', '每小时截图提问上限', 0, 600, 1],
    ['visionInputTokens', '截图每次输入 token（含图片）', 1, 256000, 1], ['visionOutputTokens', '截图每次输出 token', 1, 100000, 1],
    ['embeddingTokensPerHour', '每小时额外向量输入 token', 0, 100000000, 1], ['contingencyPercent', '上限额外预算（%）', 0, 300, 1],
  ];
  const button = (label, action, disabled = false) => h(Button ?? 'button', {type: 'button', size: 'sm', variant: 'outline', onClick: action, disabled}, label);
  function Settings() {
    const [state, setState] = React.useState(null), [draft, setDraft] = React.useState(null);
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
    const [accessKeyId, setAccessKeyId] = React.useState(''), [secret, setSecret] = React.useState(''), [token, setToken] = React.useState('');
    const details = React.useRef(null), manualInput = React.useRef(null), alive = React.useRef(true);
    function receive(next) {
      if (!alive.current) return;
      setState(next);
      setDraft({balanceSource: next.balanceSource, manualBalanceCny: next.manualBalanceCny == null ? '' : String(next.manualBalanceCny), assumptions: {...next.assumptions}});
    }
    React.useEffect(() => {
      alive.current = true;
      (async () => {
        try {
          const current = await invoke('get'); receive(current);
          if (alive.current && current.balanceSource === 'aliyun' && current.hasBillingCredentials && (!current.balance.updatedAt || Date.now() - Date.parse(current.balance.updatedAt) > 300000)) {
            setBusy(true); receive(await invoke('refresh'));
          }
        } catch (e) {if (alive.current) setError(cleanError(e));}
        finally {if (alive.current) setBusy(false);}
      })();
      return () => {alive.current = false;};
    }, []);
    async function run(work) {
      setBusy(true); setError(''); setMessage('');
      try {await work();} catch (e) {if (alive.current) setError(cleanError(e));}
      finally {if (alive.current) setBusy(false);}
    }
    function editAssumption(key, value) {setDraft(old => ({...old, assumptions: {...old.assumptions, [key]: value}})); setMessage('');}
    function revealManual() {if (details.current) details.current.open = true; manualInput.current?.focus();}
    async function update() {
      if (state?.balanceSource === 'aliyun' && state.hasBillingCredentials) await run(async () => receive(await invoke('refresh')));
      else revealManual();
    }
    function numeric(label, value, onChange, min, max, step = 'any', ref) {
      return h('label', {className: 'ib-field'}, h('span', null, label), h('input', {type: 'number', value, min, max, step, ref, disabled: busy,
        onChange: e => onChange(e.target.value), inputMode: 'decimal'}));
    }
    async function save() {
      await run(async () => {
        const assumptions = {...draft.assumptions};
        for (const [key, value] of Object.entries(assumptions)) {
          if (key === 'mode' || key === 'thinking') continue;
          if (value === '' || (typeof value === 'string' && !value.trim())) throw Error('请填完整预算数字。');
          assumptions[key] = Number(value);
        }
        const payload = {balanceSource: draft.balanceSource, assumptions};
        if (draft.balanceSource === 'manual') {
          if (!draft.manualBalanceCny.trim()) throw Error('请先输入控制台余额；金额为零时填写 0。');
          payload.manualBalanceCny = Number(draft.manualBalanceCny);
        }
        if (draft.balanceSource === 'aliyun' && (accessKeyId || secret || token)) payload.credentials = {accessKeyId: accessKeyId.trim(), accessKeySecret: secret.trim(), securityToken: token.trim()};
        // Input-only credentials are cleared even if saving fails; they are never returned by IPC.
        setAccessKeyId(''); setSecret(''); setToken('');
        let next = await invoke('save', payload); receive(next);
        if (next.balanceSource === 'aliyun' && next.hasBillingCredentials) {next = await invoke('refresh'); receive(next);}
        if (alive.current && !next.error) setMessage(next.balanceSource === 'manual' ? '手动余额与预算已保存。' : next.hasBillingCredentials ? '余额已同步，预算已保存。' : '预算已保存；账单余额尚未同步。');
      });
    }
    const view = budgetPresentation(state);
    const estimate = state?.estimate;
    const openLink = id => run(() => invoke('open-link', {id}));
    return h('section', {className: 'ib-budget', 'data-testid': 'interview-budget'},
      h('div', {className: 'ib-heading'}, h('h3', null, '余额与面试时长'), button(busy ? '更新中…' : '更新', update, busy || !state)),
      h('div', {className: 'ib-metrics'},
        h('div', null, h('span', {className: 'ib-label'}, view.source), h('strong', {'data-testid': 'interview-budget-balance'}, view.balance)),
        h('div', null, h('span', {className: 'ib-label'}, '预计还能面试 · 估算'), h('strong', {'data-testid': 'interview-budget-hours'}, view.hours))),
      h('p', {className: 'ib-caption'}, view.updated),
      (error || state?.error) && h('p', {role: 'alert', className: 'ib-error'}, error || state.error),
      message && h('p', {role: 'status', className: 'ib-caption'}, message),
      estimate?.reason && h('p', {className: 'ib-caption'}, estimate.reason),
      h('details', {ref: details, className: 'ib-details'}, h('summary', null, '余额来源与估算设置'), draft && h('div', {className: 'ib-config'},
        h('div', {className: 'ib-links'}, button('打开费用控制台', () => openLink('console'), busy), button('查看官方价格', () => openLink('pricing'), busy)),
        h('label', {className: 'ib-field'}, h('span', null, '余额来源'), h(Select, {value: draft.balanceSource, disabled: busy, onChange: e => setDraft(old => ({...old, balanceSource: e.target.value}))},
          h('option', {value: 'manual'}, '手动录入控制台余额'), h('option', {value: 'aliyun'}, '阿里云账单同步（可选）'))),
        draft.balanceSource === 'manual' ? numeric('人民币余额（元）', draft.manualBalanceCny, value => setDraft(old => ({...old, manualBalanceCny: value})), -1000000000, 1000000000, '0.01', manualInput) :
          h('div', {className: 'ib-credentials'},
            h('p', {className: 'ib-caption'}, `${state.hasBillingCredentials ? '已保存账单凭据；留空保留。' : '账单凭据未配置。'}使用与模型 Key 同一阿里云账户的 RAM 用户，仅授予读取余额权限。账户归属无法自动校验。`),
            h('p', {className: 'ib-caption'}, '模型 API Key 不适用于此处。程序只调用 QueryAccountBalance；建议授权 bss:DescribeAcccount（拼写按官方文档）。'),
            ...[['RAM AccessKey ID', accessKeyId, setAccessKeyId], ['RAM AccessKey Secret', secret, setSecret], ['SecurityToken（仅临时凭据需要）', token, setToken]].map(([label, value, change]) =>
              h('label', {className: 'ib-field', key: label}, h('span', null, label), h('input', {type: 'password', value, autoComplete: 'new-password', spellCheck: false, disabled: busy, maxLength: label.startsWith('Security') ? 8192 : 256, onChange: e => change(e.target.value)}))),
            h('div', {className: 'ib-links'}, button('只读授权说明', () => openLink('authorization'), busy), state.hasBillingCredentials && button('移除账单凭据', () => run(async () => {receive(await invoke('clear-credentials')); setAccessKeyId(''); setSecret(''); setToken(''); setMessage('账单凭据已移除。');}), busy))),
        h('label', {className: 'ib-field'}, h('span', null, '估算方式'), h(Select, {value: draft.assumptions.mode, disabled: busy, onChange: e => editAssumption('mode', e.target.value)},
          h('option', {value: 'model'}, '按北京区模型价格与用量假设'), h('option', {value: 'custom'}, '自定义每小时预算区间'))),
        numeric('暂不用于面试的余额（元）', draft.assumptions.reserveCny, value => editAssumption('reserveCny', value), 0, 1000000000, '0.01'),
        draft.assumptions.mode === 'custom' ? h(React.Fragment, null,
          h('div', {className: 'ib-grid'}, numeric('每小时预算下限（元）', draft.assumptions.hourlyLowCny, v => editAssumption('hourlyLowCny', v), 0.01, 1000000, '0.01'), numeric('每小时预算上限（元）', draft.assumptions.hourlyHighCny, v => editAssumption('hourlyHighCny', v), 0.01, 1000000, '0.01')),
          h('p', {className: 'ib-caption'}, '这是你设置的总预算区间，不是官方小时单价。请包含双路语音、文字、截图、重试等所有费用；初始 3–8 元仅为可修改的规划假设。')) :
          h(React.Fragment, null,
            h('p', {className: 'ib-caption'}, '价格核对于 2026-10-25：语音 ¥0.00033/秒；双路连续一小时 ¥2.376。qwen-plus 输入/输出 ¥0.8/2 每百万 token（输入≤128k，非思考）；qwen3-vl-plus ¥1/10（输入≤32k）；向量 ¥0.5/百万。更长输入和思考模式自动采用对应阶梯。'),
            h('div', {className: 'ib-grid'}, numericFields.map(([key, label, min, max, step]) => h(React.Fragment, {key}, numeric(label, draft.assumptions[key], value => editAssumption(key, value), min, max, step)))),
            h('label', {className: 'ib-check'}, h('input', {type: 'checkbox', checked: draft.assumptions.thinking, disabled: busy, onChange: e => editAssumption('thinking', e.target.checked)}), '按 qwen-plus 思考模式计费（输出含思考 token）'),
            h('p', {className: 'ib-caption'}, '文字问题不含截图。每个付费问题累计计入两轮模型选卡及生成回答，默认输入约 12k–30k、输出约 800–2400 token，均为可修改假设。只有完全不调用模型的本地卡直出可计入免费比例，默认按 0%；模型选卡后显示原卡仍产生选卡费用。输入含历史上下文；累计输入用于保守选阶梯，多个短调用的实际费用可能更低。图片折算为输入 token，双路重复音频仍按两路预算。')),
        estimate?.hourlyLowCny != null && h('p', {className: 'ib-caption'}, `已保存假设：约 ¥${compactNumber(estimate.hourlyLowCny)}–${compactNumber(estimate.hourlyHighCny)}/小时。编辑后保存才会更新大数。`),
        h('p', {className: 'ib-caption'}, '时长是余额快照下的预算估算，不是实时剩余配额；未扣除之后的调用、延迟账单或账户其他产品消费。自动余额取现金与可用额度较小值，不计授信、免费量、资源包和优惠。预留余额可留给其他用途；下限按较高成本计算。'),
        h('div', {className: 'ib-links'}, button('保存', save, busy))))
    );
  }
  return {Settings};
}

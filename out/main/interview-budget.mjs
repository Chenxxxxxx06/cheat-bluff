import {createHmac, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {authorizeRecordExport} from './interview-export.mjs';

export const BALANCE_ENDPOINT = 'https://business.aliyuncs.com/';
export const BUDGET_LINKS = Object.freeze({
  console: 'https://usercenter2.aliyun.com/finance/home',
  pricing: 'https://help.aliyun.com/zh/model-studio/model-pricing',
  authorization: 'https://help.aliyun.com/zh/user-center/developer-reference/api-calling-authorization',
  balanceApi: 'https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance',
});
export const PRICE_SNAPSHOT = Object.freeze({
  checkedOn: '2026-10-25', currency: 'CNY', region: '华北2（北京）',
  asrModel: 'qwen-audio-3.0-asr-flash-streaming', asrPerSecond: 0.00033,
  textModel: 'qwen-plus', visionModel: 'qwen3-vl-plus', embeddingModel: 'text-embedding-v4',
  embeddingPerMillion: 0.5,
  sources: [
    'https://help.aliyun.com/zh/model-studio/qwen-audio-3-0-asr-flash-streaming',
    'https://help.aliyun.com/zh/model-studio/qwen-plus',
    'https://help.aliyun.com/zh/model-studio/qwen3-vl-plus',
    'https://help.aliyun.com/zh/model-studio/text-embedding-v4',
  ],
});
export const DEFAULT_BUDGET_ASSUMPTIONS = Object.freeze({
  mode: 'model', reserveCny: 0,
  // A user-editable planning envelope, never described as an official hourly price.
  hourlyLowCny: 3, hourlyHighCny: 8,
  asrStreams: 2, asrMinutesPerHour: 60,
  questionsPerHourLow: 20, questionsPerHourHigh: 40, localCardPercent: 0,
  // Includes both model-based card selection calls and any generated answer.
  // Local direct display has no model cost, but its unmeasured hit rate defaults to zero.
  textInputTokensLow: 12000, textInputTokensHigh: 30000,
  textOutputTokensLow: 800, textOutputTokensHigh: 2400, thinking: false,
  visionCallsPerHourLow: 0, visionCallsPerHourHigh: 6,
  visionInputTokens: 4000, visionOutputTokens: 1000,
  embeddingTokensPerHour: 0, contingencyPercent: 25,
});

export class InterviewBudgetError extends Error {
  constructor(code, message) {super(message); this.name = 'InterviewBudgetError'; this.code = code;}
}
const fail = (code, message) => {throw new InterviewBudgetError(code, message);};
const clone = value => structuredClone(value);
function object(value) {return value && typeof value === 'object' && !Array.isArray(value);}
function number(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    fail('invalid_input', `${label}数值无效。`);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('invalid_input', '余额更新时间无效。');
  return new Date(value).toISOString();
}
export function validateBudgetAssumptions(input = {}) {
  if (!object(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_BUDGET_ASSUMPTIONS, key))) fail('invalid_input', '预算参数格式无效。');
  const value = {...DEFAULT_BUDGET_ASSUMPTIONS, ...input};
  if (!['model', 'custom'].includes(value.mode) || typeof value.thinking !== 'boolean') fail('invalid_input', '估算方式无效。');
  const bounds = {
    reserveCny: [0, 1e9], hourlyLowCny: [0.01, 1e6], hourlyHighCny: [0.01, 1e6],
    asrStreams: [0, 2, true], asrMinutesPerHour: [0, 60],
    questionsPerHourLow: [0, 600], questionsPerHourHigh: [0, 600], localCardPercent: [0, 100],
    textInputTokensLow: [1, 1e6, true], textInputTokensHigh: [1, 1e6, true],
    textOutputTokensLow: [1, 1e5, true], textOutputTokensHigh: [1, 1e5, true],
    visionCallsPerHourLow: [0, 600], visionCallsPerHourHigh: [0, 600],
    visionInputTokens: [1, 256000, true], visionOutputTokens: [1, 1e5, true],
    embeddingTokensPerHour: [0, 1e8, true], contingencyPercent: [0, 300],
  };
  for (const [key, args] of Object.entries(bounds)) number(value[key], key, ...args);
  for (const [low, high] of [['hourlyLowCny', 'hourlyHighCny'], ['questionsPerHourLow', 'questionsPerHourHigh'], ['textInputTokensLow', 'textInputTokensHigh'], ['textOutputTokensLow', 'textOutputTokensHigh'], ['visionCallsPerHourLow', 'visionCallsPerHourHigh']])
    if (value[low] > value[high]) fail('invalid_input', '估算下限不能高于上限。');
  return value;
}

export function matchesBudgetPriceSnapshot(settings) {
  try {
    return settings?.provider === 'qwen' && new URL(settings.baseUrl).origin === 'https://dashscope.aliyuncs.com'
      && new URL(settings.asrUrl).origin === 'wss://dashscope.aliyuncs.com'
      && ['textModel', 'visionModel', 'embeddingModel', 'asrModel'].every(key => settings[key] === PRICE_SNAPSHOT[key]);
  } catch {return false;}
}
function textPrice(tokens, thinking) {
  return tokens <= 128000 ? [0.8, thinking ? 8 : 2] : tokens <= 256000 ? [2.4, thinking ? 24 : 20] : [4.8, thinking ? 64 : 48];
}
function visionPrice(tokens) {return tokens <= 32000 ? [1, 10] : tokens <= 128000 ? [1.5, 15] : [3, 30];}
export function estimateInterviewBudget(balance, assumptions = {}, {pricesMatch = true} = {}) {
  const a = validateBudgetAssumptions(assumptions);
  if (a.mode === 'model' && !pricesMatch) return {status: 'model_mismatch', reason: '当前模型或地域不匹配此价格快照，请改用自定义每小时预算。'};
  let low = a.hourlyLowCny, high = a.hourlyHighCny, components = null;
  if (a.mode === 'model') {
    const asr = a.asrStreams * a.asrMinutesPerHour * 60 * PRICE_SNAPSHOT.asrPerSecond;
    const embedding = a.embeddingTokensPerHour * PRICE_SNAPSHOT.embeddingPerMillion / 1e6;
    const paidRatio = 1 - a.localCardPercent / 100;
    const priceText = (questions, input, output) => {
      const [i, o] = textPrice(input, a.thinking);
      return questions * paidRatio * (input * i + output * o) / 1e6;
    };
    const [vi, vo] = visionPrice(a.visionInputTokens);
    const visionPerCall = (a.visionInputTokens * vi + a.visionOutputTokens * vo) / 1e6;
    const textLow = priceText(a.questionsPerHourLow, a.textInputTokensLow, a.textOutputTokensLow);
    const textHigh = priceText(a.questionsPerHourHigh, a.textInputTokensHigh, a.textOutputTokensHigh);
    low = asr + embedding + textLow + a.visionCallsPerHourLow * visionPerCall;
    const highBase = asr + embedding + textHigh + a.visionCallsPerHourHigh * visionPerCall;
    high = highBase * (1 + a.contingencyPercent / 100);
    components = {asr, embedding, textLow, textHigh, visionLow: a.visionCallsPerHourLow * visionPerCall, visionHigh: a.visionCallsPerHourHigh * visionPerCall, contingency: high - highBase};
  }
  const rates = {hourlyLowCny: low, hourlyHighCny: high, components};
  if (!balance || balance.amount === null) return {status: 'no_balance', ...rates};
  if (balance.currency !== 'CNY') return {status: 'currency_mismatch', reason: '仅支持人民币预算，不自动换汇。', ...rates};
  number(balance.amount, '余额', -1e9, 1e9);
  // AvailableAmount can include credit, while cash can exceed available quota.
  // Use the smaller value: never count a credit line as owned cash.
  const capped = balance.availableAmount == null ? balance.amount : Math.min(balance.amount, number(balance.availableAmount, '可用额度', -1e9, 1e9));
  const spendableCny = Math.max(0, capped - a.reserveCny);
  if (spendableCny === 0) return {status: 'ready', hoursLow: 0, hoursHigh: 0, spendableCny, ...rates};
  if (low <= 0 || high <= 0) return {status: 'zero_rate', reason: '当前假设计费为零，无法给出有限时长；请保留语音费用或使用自定义预算。', ...rates};
  return {status: 'ready', hoursLow: spendableCny / high, hoursHigh: spendableCny / low, spendableCny, ...rates};
}

function credentials(input) {
  if (!object(input) || Object.keys(input).some(k => !['accessKeyId', 'accessKeySecret', 'securityToken'].includes(k))) fail('invalid_credentials', '账单凭据格式无效。');
  const result = {};
  for (const [key, min, max] of [['accessKeyId', 10, 128], ['accessKeySecret', 16, 256], ['securityToken', 0, 8192]]) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length < min || value.length > max || /[^\x21-\x7e]/.test(value)) fail('invalid_credentials', '请输入有效的 RAM AccessKey 凭据；不要填写模型 API Key。');
    result[key] = value;
  }
  if (/^sk-/i.test(result.accessKeyId) || /^sk-/i.test(result.accessKeySecret)) fail('invalid_credentials', '模型 API Key 不能查询账户余额，请使用 RAM 账单凭据。');
  return result;
}
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
export function signBalanceRequest(input, {now = Date.now(), nonce = randomUUID()} = {}) {
  const c = credentials(input);
  const params = {Action: 'QueryAccountBalance', Version: '2017-12-14', Format: 'JSON', AccessKeyId: c.accessKeyId,
    SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0', SignatureNonce: nonce, Timestamp: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z')};
  if (c.securityToken) params.SecurityToken = c.securityToken;
  const canonical = Object.keys(params).sort().map(k => `${encode(k)}=${encode(params[k])}`).join('&');
  const signature = createHmac('sha1', `${c.accessKeySecret}&`).update(`POST&%2F&${encode(canonical)}`).digest('base64');
  // Parameters are sent in a POST body, never in the URL or application logs.
  return `${canonical}&Signature=${encode(signature)}`;
}
function accountAmount(value) {
  if (typeof value !== 'string' || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(value)) fail('invalid_response', '账单接口返回了无效金额。');
  return number(Number(value.replaceAll(',', '')), '账单金额', -1e9, 1e9);
}
async function readBoundedJson(response) {
  if (Number(response.headers?.get('content-length') ?? 0) > 65536) {await response.body?.cancel().catch(() => {}); fail('invalid_response', '账单接口响应异常。');}
  const reader = response.body?.getReader();
  if (!reader) fail('invalid_response', '账单接口响应为空。');
  const chunks = []; let length = 0;
  try {
    for (;;) {const {done, value} = await reader.read(); if (done) break; length += value.byteLength; if (length > 65536) fail('invalid_response', '账单接口响应异常。'); chunks.push(Buffer.from(value));}
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail('invalid_response', '账单接口没有返回有效 JSON。');}
  } finally {await reader.cancel().catch(() => {});}
}
export async function queryAliyunAccountBalance(input, {fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 10000} = {}) {
  const body = signBalanceRequest(input, {now});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(BALANCE_ENDPOINT, {method: 'POST', redirect: 'error', signal: controller.signal,
      headers: {'content-type': 'application/x-www-form-urlencoded; charset=utf-8', accept: 'application/json'}, body});
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) fail('balance_auth', '余额同步未授权，请检查 RAM 凭据和只读余额权限。');
      fail('balance_http', '账单接口暂不可用，请稍后更新或手动录入余额。');
    }
    const result = await readBoundedJson(response);
    if (result?.Success !== true || String(result.Code) !== '200') {
      if (['NoPermission', 'NotAuthorized', 'InvalidAccessKeyId.NotFound', 'SignatureDoesNotMatch', 'InvalidSecurityToken.Expired'].includes(result?.Code)) fail('balance_auth', '余额同步未授权，请检查 RAM 凭据、权限和凭据有效期。');
      fail('balance_rejected', '账单接口未返回成功结果，请核对账户授权后重试。');
    }
    if (result.Data?.Currency !== 'CNY') fail('balance_currency', '该账单账户不是人民币账户，无法用于当前人民币估算。');
    return {amount: accountAmount(result.Data.AvailableCashAmount), availableAmount: accountAmount(result.Data.AvailableAmount), currency: 'CNY', updatedAt: new Date(now).toISOString()};
  } catch (error) {
    if (error instanceof InterviewBudgetError) throw error;
    fail(controller.signal.aborted ? 'balance_timeout' : 'balance_network', controller.signal.aborted ? '余额同步超时，已保留上次快照。' : '余额同步失败，请检查网络；上次快照仍保留。');
  } finally {clearTimeout(timer);}
}

function initialState() {return {version: 1, balanceSource: 'manual', manualBalance: null, cloudBalance: null, credentials: null, assumptions: clone(DEFAULT_BUDGET_ASSUMPTIONS)};}
function storedBalance(value) {
  if (value === null) return null;
  if (!object(value) || value.currency !== 'CNY') fail('invalid_input', '余额存储格式无效。');
  return {amount: number(value.amount, '余额', -1e9, 1e9), currency: 'CNY', updatedAt: timestamp(value.updatedAt),
    ...(value.availableAmount == null ? {} : {availableAmount: number(value.availableAmount, '可用额度', -1e9, 1e9)})};
}
export class InterviewBudgetStore {
  #state = initialState(); #tail = Promise.resolve(); #inflight = null; #generation = 0; #loadError = null; #refreshError = null;
  constructor({filePath, safeStorage, getAiSettings = () => null, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10000}) {
    Object.assign(this, {filePath, safeStorage, getAiSettings, fetchImpl, now, timeoutMs});
  }
  #secure() {
    if (!this.safeStorage?.isEncryptionAvailable?.() || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') fail('storage_unavailable', '系统加密存储不可用，余额和账单凭据不会以明文保存。');
  }
  async initialize() {
    try {
      const file = await readFile(this.filePath, 'utf8'); this.#secure();
      const envelope = JSON.parse(file);
      if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string') throw Error();
      const raw = JSON.parse(this.safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64')));
      if (raw.version !== 1 || !['manual', 'aliyun'].includes(raw.balanceSource)) throw Error();
      this.#state = {version: 1, balanceSource: raw.balanceSource, manualBalance: storedBalance(raw.manualBalance), cloudBalance: storedBalance(raw.cloudBalance), credentials: raw.credentials === null ? null : credentials(raw.credentials), assumptions: validateBudgetAssumptions(raw.assumptions)};
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#loadError = '预算文件无法解密或读取，已保留原文件；请恢复本机安全存储后重启。';
    }
    return this;
  }
  #enqueue(fn) {const result = this.#tail.then(fn); this.#tail = result.catch(() => {}); return result;}
  async #commit(next) {
    if (this.#loadError) fail('storage_locked', this.#loadError);
    this.#secure();
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const ciphertext = this.safeStorage.encryptString(JSON.stringify(next)).toString('base64');
      await mkdir(dirname(this.filePath), {recursive: true});
      await writeFile(temporary, JSON.stringify({version: 1, ciphertext}) + '\n', {encoding: 'utf8', mode: 0o600});
      await rename(temporary, this.filePath); this.#state = next;
    } catch {await rm(temporary, {force: true}).catch(() => {}); fail('storage_write', '预算未能安全保存，请检查本地数据目录。');}
  }
  getPublicState() {
    const s = this.#state;
    const snapshot = s.balanceSource === 'aliyun' ? s.cloudBalance : s.manualBalance;
    const balance = snapshot ? {...clone(snapshot), source: s.balanceSource, stale: this.now() - Date.parse(snapshot.updatedAt) > 86400000} : {amount: null, currency: 'CNY', source: 'unsynced', updatedAt: null, stale: false};
    let pricesMatch = false;
    try {pricesMatch = matchesBudgetPriceSnapshot(this.getAiSettings());} catch { /* No credential or settings errors cross this boundary. */ }
    return {version: 1, balanceSource: s.balanceSource, balance, manualBalanceCny: s.manualBalance?.amount ?? null, assumptions: clone(s.assumptions), hasBillingCredentials: Boolean(s.credentials),
      estimate: estimateInterviewBudget(balance, s.assumptions, {pricesMatch}), pricesMatch,
      priceSnapshot: clone(PRICE_SNAPSHOT), error: this.#loadError || this.#refreshError, refreshing: Boolean(this.#inflight)};
  }
  async save(input = {}) {
    if (!object(input) || Object.keys(input).some(k => !['balanceSource', 'manualBalanceCny', 'assumptions', 'credentials'].includes(k))) fail('invalid_input', '预算设置格式无效。');
    return this.#enqueue(async () => {
      const next = clone(this.#state);
      if (Object.hasOwn(input, 'balanceSource')) {if (!['manual', 'aliyun'].includes(input.balanceSource)) fail('invalid_input', '余额来源无效。'); next.balanceSource = input.balanceSource;}
      if (Object.hasOwn(input, 'manualBalanceCny')) next.manualBalance = input.manualBalanceCny === null ? null : {amount: number(input.manualBalanceCny, '手动余额', -1e9, 1e9), currency: 'CNY', updatedAt: new Date(this.now()).toISOString()};
      if (Object.hasOwn(input, 'assumptions')) {if (!object(input.assumptions)) fail('invalid_input', '预算参数格式无效。'); next.assumptions = validateBudgetAssumptions({...next.assumptions, ...input.assumptions});}
      const credentialChange = Object.hasOwn(input, 'credentials');
      if (credentialChange) {next.credentials = credentials(input.credentials); next.cloudBalance = null;}
      const sourceChange = next.balanceSource !== this.#state.balanceSource;
      await this.#commit(next);
      if (credentialChange || sourceChange) this.#generation++;
      this.#refreshError = null;
      return this.getPublicState();
    });
  }
  async clearCredentials() {
    return this.#enqueue(async () => {
      await this.#commit({...this.#state, credentials: null, cloudBalance: null, balanceSource: 'manual'});
      this.#generation++; this.#refreshError = null; return this.getPublicState();
    });
  }
  async clearAll() {
    // Main-process local-data reset. This also works when encryption is unavailable
    // or the existing file is corrupt; no decryption is needed to remove it.
    return this.#enqueue(async () => {
      try {
        // A process crash can leave an encrypted atomic-write temporary file.
        // Remove only files with this store's exact UUID temporary-name shape.
        const prefix = `${basename(this.filePath)}.`;
        const entries = await readdir(dirname(this.filePath)).catch(error => {if (error.code === 'ENOENT') return []; throw error;});
        for (const name of entries) if (name.startsWith(prefix) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(name.slice(prefix.length))) await rm(join(dirname(this.filePath), name), {force: true});
        await rm(this.filePath, {force: true});
      } catch {fail('storage_clear', '预算数据未能清除，请检查本地数据目录。');}
      this.#state = initialState(); this.#generation++; this.#loadError = null; this.#refreshError = null;
      return this.getPublicState();
    });
  }
  async refreshBalance() {
    await this.#tail;
    if (this.#loadError) fail('storage_locked', this.#loadError);
    if (this.#state.balanceSource !== 'aliyun' || !this.#state.credentials) fail('balance_unconfigured', '尚未配置账单同步，可先手动录入控制台余额。');
    if (this.#inflight) return this.#inflight;
    const generation = this.#generation, credential = clone(this.#state.credentials);
    this.#inflight = (async () => {
      try {
        const balance = await queryAliyunAccountBalance(credential, {fetchImpl: this.fetchImpl, now: this.now(), timeoutMs: this.timeoutMs});
        await this.#enqueue(async () => {if (generation === this.#generation) {await this.#commit({...this.#state, cloudBalance: balance}); this.#refreshError = null;}});
      } catch (error) {
        if (generation === this.#generation) this.#refreshError = error instanceof InterviewBudgetError ? error.message : '余额同步失败，已保留上次快照。';
      } finally {this.#inflight = null;}
      return this.getPublicState();
    })();
    return this.#inflight;
  }
}

export function registerInterviewBudgetIpc({ipcMain, BrowserWindow, shell, store}) {
  ipcMain.handle('interview-budget:invoke', async (event, action, input = {}) => {
    if (!authorizeRecordExport(event, BrowserWindow)) throw Error('当前页面无权访问预算设置。');
    try {
      if (action === 'get') return store.getPublicState();
      if (action === 'save') return await store.save(input);
      if (action === 'refresh') return await store.refreshBalance();
      if (action === 'clear-credentials') return await store.clearCredentials();
      if (action === 'open-link' && typeof input?.id === 'string' && Object.hasOwn(BUDGET_LINKS, input.id)) {await shell.openExternal(BUDGET_LINKS[input.id]); return {opened: true};}
      fail('invalid_action', '未知预算操作。');
    } catch (error) {throw Error(error instanceof InterviewBudgetError ? error.message : '预算操作失败，请稍后重试。');}
  });
}

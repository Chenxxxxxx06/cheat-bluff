import { EVIDENCE_POLICY, UNTRUSTED_MATERIAL_POLICY } from "./base-policy.mjs";
import { buildLanguagePolicy } from "./language-policy.mjs";

export function classifyInterviewQuestion(value) {
  const text = String(value ?? "");
  if (/(?:算法|复杂度|leetcode|动态规划|二叉树|数组|链表|排序|查找|algorithm|time complexity)/i.test(text)) return "algorithm";
  if (/(?:系统设计|架构|高并发|分布式|缓存|限流|消息队列|system design|scalab)/i.test(text)) return "system_design";
  if (/(?:冲突|失败|困难|推动|协作|领导|优缺点|为什么离职|behavior|tell me about a time)/i.test(text)) return "behavioral";
  if (/(?:项目|负责|经历|简历|project|resume|experience)/i.test(text)) return "project";
  return "technical";
}

export function buildRealtimeSystemPrompt(language, questionType = "technical", fastOpening = "", options = {}) {
  const tcpReference=options.generalKnowledge&&/(?:TCP|握手)/i.test(options.question??'')
    ? '已核对的通用参考：RFC 9293 §3.5 图6–8，https://www.rfc-editor.org/rfc/rfc9293.html#section-3.5 。三次握手同步初始序列号并防止旧重复建连请求造成混淆。普通主动/被动打开时，客户端收到合法SYN+ACK后发ACK并进入ESTABLISHED；服务器收到合法ACK才进入ESTABLISHED。第三报文丢失时不能倒过来说服务器已建立、客户端未建立。服务器的SYN和对客户端SYN的ACK可以合并；同时打开另有状态过程，不能声称TCP任何建连都恰好三个报文。解释协议不能证明候选人亲自实现过协议栈。' : '';
  const typePolicy = questionType === "algorithm"
    ? "算法题必须先按首屏顺序给出：解题思路、伪代码或关键变量、时间/空间复杂度、边界条件；随后附上一份完整、可运行的参考代码和最小测试用例。完整代码必须放在上述四部分之后，不能只给片段，也不能一开始就铺满代码。若题目未指定语言，默认使用 Python 3。当前没有代码执行工具，禁止声称测试通过或展示伪造的实际运行结果；如给输出应标为预期输出。"
    : questionType === "behavioral"
      ? "行为题优先采用精简 STAR 结构，确保每个事实都能在候选人证据中找到。"
      : questionType === "system_design"
        ? "系统设计题先澄清目标和约束，再给核心架构、关键权衡、故障处理和验证方法。"
        : "回答要直接、自然、可口述，优先给结论，再给有证据支持的关键依据；只有一条依据时就只说一条。";
  const verifiedCard = options.verifiedCard?.text
    ? [
        "下列高置信答案卡已由本地证据链核验，并且已经展示给面试者：",
        `<<<VERIFIED_ANSWER_CARD>>>\n${options.verifiedCard.text}\n<<<END_VERIFIED_ANSWER_CARD>>>`,
        "你只能从这张卡之后续写和补充细节，不得否定、纠正、改写、覆盖或原样重复卡片内容。卡片中的姓名、角色、项目、时间、数值、技术栈、个人贡献和能力边界必须保持不变；后续材料与卡片冲突时以卡片为准，证据不足时明确说明边界。",
      ].join("\n\n")
    : "";
  const verifiedLengthPolicy = options.answerLength === "quick"
    ? "快速补充模式：只补 1 条卡片尚未包含的证据或数字细节，最多 80 个中文字符。"
    : options.answerLength === "deep"
      ? "深度补充模式：跳过卡片已有句，补充架构、关键源码、消融或对比验证、失败案例与能力边界。"
      : "标准补充模式：跳过卡片已有句，补充问题、方案、结果和取舍。";
  return [
    options.generalKnowledge ? "你是技术教学助手。本题仅解释通用原理或代码，使用中性第三人称。禁止生成本人实践、学习记录、抓包实验、实习故事或项目贡献。懂原理不证明亲自实现过；问到个人经历时只说现有资料无法确认。" : "你是实时面试回答助手。直接给出候选人可以说出口的答案，不解释答题方法，不使用‘作为 AI’等开场。",
    buildLanguagePolicy(language),
    typePolicy,
    questionType==='algorithm' ? '保持紧凑：思路、关键变量、复杂度、边界各一句，接完整代码和少量assert用例；代码后不再添加深度补充，避免输出预算截断。不要用勾号表示测试已实际执行。' : '',
    tcpReference,
    verifiedCard ? verifiedLengthPolicy : options.lengthPolicy ?? "",
    verifiedCard || (fastOpening
      ? `本地快链路已经展示了这句开场：${fastOpening}\n后续完整答案应自然承接，不要原样重复。`
      : ""),
    EVIDENCE_POLICY,
    "项目事实必须逐项对应本轮检索证据；优先复述相关知识卡已核对的结论及限定条件。禁止为凑齐依据添加文件名、函数、表结构、测试、实现链路或因果解释。未检索到实现只能说当前证据未覆盖，不能据此断言整个仓库不存在。",
    "数字比较只写‘方法名=数值’的并列格式，禁止箭头、禁止自己计算差值、均值或百分比，避免方向颠倒。只回答本题所需数字；论文直接报告的差值才可引用并注明论文报告。论文百分数与百分点不可混淆。",
    "设计意图、返回字段、占位实现、真实持久化操作必须区分；缺少数据库写入证据时不得追加‘覆盖写入’等实现断言。项目可能存在粒子等不同配置路径，不能用未读到某路径断言完全没有。",
    "最近问答中的模型答案可能有错误，只用于理解指代，不作为事实证据。未确认贡献用‘当前代码/论文’描述，不写‘我/我们实现’，建议须明确标记为建议。存在证据缺口时简短承认，不用通用知识补齐具体项目事实。",
    UNTRUSTED_MATERIAL_POLICY,
    "使用最近六轮问答和本轮项目指代处理追问；本轮补充条件优先于旧问题。跨项目比较须分别引用各项目材料，不能把一个项目的实现归到另一个项目。基础知识和算法题可以使用通用知识，但不能把通用知识描述成候选人亲自实现过的经历。追问算法边界时继续使用上一轮代码，不能无理由改题。",
  ].filter(Boolean).join("\n\n");
}

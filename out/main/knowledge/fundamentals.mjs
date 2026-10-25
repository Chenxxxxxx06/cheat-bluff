// Small, audited teaching cards. These are general facts, never biography.
export function buildFundamentalsResponse(question, context) {
  if(!context?.generalKnowledge)return null;
  const text=String(question??'');
  if(/(?:TCP|三次握手)/i.test(text)&&/(?:为什么|为何|三次|两次|第三次|握手流程)/.test(text)&&!/(?:TLS|HTTPS|QUIC|拥塞|四次挥手|代码实现|写.{0,4}协议栈)/i.test(text))return {
    source:'verified_fundamentals_card',evidenceIds:['rfc9293-section3.5'],
    text:'TCP普通主动/被动建连用三次握手来同步双方初始序列号，并避免旧的重复建连请求造成混淆。\n\n客户端先发SYN；服务端返回SYN+ACK，既确认客户端的序列号，也告知自己的序列号；客户端再发ACK，确认服务端的序列号。第二个报文合并了SYN与ACK，所以普通流程不必拆成四个报文。\n\n不能把第三次ACK丢失时的状态说反：客户端收到合法SYN+ACK并发ACK后已进入ESTABLISHED；服务端在收到合法ACK前仍处于SYN-RECEIVED。握手不是对网络永不丢包的保证；同时打开也有不同的报文过程。\n\n懂这些原理不证明亲自实现过TCP；现有资料不足以确认个人协议栈实现经历。依据：RFC 9293 §3.5、图6–8：https://www.rfc-editor.org/rfc/rfc9293.html#section-3.5'
  };
  if(/两数之和/.test(text)&&!/(?:有序|全部|所有|多组|不.{0,5}哈希|不用.{0,5}(?:字典|额外)|空间.{0,8}O\(1\)|三数|Java|C\+\+|JavaScript|TypeScript|Rust|Golang|Go语言|返回.{0,4}数值)/i.test(text))return {
    source:'verified_fundamentals_card',evidenceIds:['audited-two-sum-python'],
    text:'适用范围：返回一组原数组下标，允许重复值，同一下标不能复用；无解返回空列表。\n\n思路：从左往右遍历，先查补数是否在此前的字典中，再记录当前值，因此不会匹配当前元素自身。关键变量是“数值→先前下标”的字典。平均时间O(n)，额外空间O(n)；检查空数组、单元素、重复值与无解。\n\n```python\ndef two_sum(nums, target):\n    seen = {}\n    for i, value in enumerate(nums):\n        other = target - value\n        if other in seen:\n            return [seen[other], i]\n        if value not in seen:\n            seen[value] = i\n    return []\n\n# 以下是可运行的测试断言；应用回答时不会自动执行。\nassert two_sum([2, 7, 11, 15], 9) == [0, 1]\nassert two_sum([3, 3], 6) == [0, 1]\nassert two_sum([1, 2, 2, 4], 5) == [0, 3]\nassert two_sum([], 0) == []\nassert two_sum([5], 5) == []\nassert two_sum([1, 2], 4) == []\n```\n\n对于[3,3]和目标6：第0轮字典为空，随后记录3→0；第1轮查到之前的0号下标，返回[0,1]。如果题目改变返回要求、排序条件或空间限制，需要重新分析，不能直接套用本卡。'
  };
  return null;
}

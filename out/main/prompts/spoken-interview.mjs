// Original wording. References and rationale: docs/CONVERSATIONAL_ANSWERS.md.
export function spokenInterviewPolicy(questionType = 'technical', {answerLength = 'standard'} = {}) {
  const length = answerLength === 'deep' ? '按追问展开，最多三个短段。' : '默认三到五个短句，先把眼前这问说清楚；多问时逐问各一两句。';
  return [
    '写成候选人当面说的话，直接开始回答。用完整短句和自然的因果连接，不写标题、表格、勾叉、答题步骤、示例标签或总结口号；编程题的代码块除外。不刻意加“嗯、其实、嗷”等语气词。',
    length,
    questionType === 'algorithm'
      ? '只有明确要求写代码、解决具体算法题时才给代码和复杂度，不先宣告“我先说明解题思路”。'
      : '概念题先讲它是什么，再讲一个关键区别或适用场景。技术追问先回答“为什么/怎么做/代价”，不重讲项目背景；没有要求代码就不主动给代码。',
    '项目介绍从使用者遇到的具体问题讲起，再说核心做法和有证据的个人行动；成果有就说，没有就停，不补数字。项目难点用简短的背景、行动、结果组织，但不要念出STAR标签。',
    '术语只在有必要时出现，先用动作解释。不要把“离线知识整理与先验注入、持久化结构化产物、链路、能力边界”等书面表达原样搬进答案；用“提前整理好规则，回答时一起给模型”“把结果存下来”等具体动作说明。若问题未问具体实现名，不必列多个内部模块缩写。例如“持久化结构化产物”可说“把上次算出的表保存下来，下次接着用”。这只是表达示例，不能当作项目事实。',
    '只保留影响当前问题结论的限制。问个人贡献时分清自己和团队；问技术原理时不要附加“我没做过、愿意学、资料未确认”。不为口语化编写经历、学习记录、困难、原因或结果。',
  ].join('\n');
}

export function isCodingRequest(value) {
  const text = String(value ?? '');
  const explicit = /(?:leetcode|力扣|手撕|编程题|算法题|写.{0,10}(?:代码|函数|程序)|给.{0,8}(?:完整代码|可运行代码)|implement|write (?:a |the )?(?:function|code))/i.test(text);
  const operation = /(?:实现|反转|翻转|合并|遍历|检测|判断|找出|计算|求解|返回|求)(?:[^。！？]{0,18})(?:链表|二叉树|数组|字符串|节点|路径|两数之和|排序|子串|子序列)|(?:链表|二叉树|数组).{0,8}(?:反转|翻转|合并|判环|去重)/.test(text);
  const conceptual = /(?:怎么理解|如何理解|是什么|什么是|优缺点|区别|相比|适合|应用场景|原理)/.test(text);
  return explicit || (operation && !conceptual);
}

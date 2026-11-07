function executionPolicyFrame(session) {
  const mode = session.approvalMode === 'auto' ? 'auto' : 'ask';
  return `\n<execution-policy mode="${mode}">这是当前会话的执行设置，覆盖历史对话中的旧模式描述。
当前产品对外名称是 SoloPi Desktop；历史品牌名、旧工具别名和旧读取回执不是当前产品或 Skill 来源，使用当前目录返回的规范名称及 absolutePath，不重复维护新旧两份 Skill。
${mode === 'auto'
    ? '当前为自动执行：用户当前目标和已经明确授予的范围内，直接执行必要的查询、修改、保存和验证，不为这些操作重复索取确认。用户已说“都做”或已选择方案时沿用该授权；常规实现选择根据证据自行决定并说明，不把同一选择拆成新一轮确认。'
    : '当前为逐次确认：需要审批的工具由执行器展示审批；先完成可直接进行的只读核实，不用文字提问重复代替工具审批。'}
自动执行不扩大用户授权范围。只有缺少无法从上下文或只读查询获得的必要信息、范围发生实质变化或适用规则明确要求额外确认时才询问，并说明具体原因。不要把所有写操作默认解释为必须重新询问；只读路径、版本和组件定义的核对直接用工具完成。
</execution-policy>\n` + require('./task-execution-contract').frame() + require('./task-execution-state').frame(session);
}
module.exports = { executionPolicyFrame };

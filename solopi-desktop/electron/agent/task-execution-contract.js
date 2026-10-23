// A small, unconditional execution contract; detailed CLI instructions remain
// on demand. This describes policy, never infers authorization from user text.
const revision = 'task-execution-v1';
function frame() {
  return `\n<task-execution-contract revision="${revision}">
本规则始终生效，不以是否加载任务 Skill 为前提。执行已有用例时：
- 从原始用户请求及其后续更正确定仍有效的范围与选项；缺少上下文先用read_user_messages找回，不让用户重复交代。明确的暂停、取消和替换优先，不能由历史授权自动恢复。
- 不同查询方式得到相同caseId集合，不构成范围歧义，不制造二选一确认。用户按目录或范围要求全部执行时，清单内草稿标记本身不新增确认要求；运行可用性由提交校验处理，不擅自排除或修改用例。
- 同一任务延续中已明确的录屏、性能采集、排除条件继续有效，除非用户更正；不要从无关旧任务借用选项、设备或授权。设备实时核对，包名沿用默认。
- 范围和必要参数已确定，直接按当前执行模式调用提交工具；逐次确认模式使用执行器审批，不再用口头问题重复审批。只在真正缺少必要信息、范围实质变化或规则明确要求时询问具体缺口。
- 用户要求压测但未指定轮数或时长仍须询问。已有成功taskId或提交结果未知时先查回执，不重复提交；任务通知不新增修改用例、停止任务或上报缺陷的授权。
</task-execution-contract>\n`;
}
function metadata(session) {
  const reads = Object.entries(session.skillReads || {});
  const state = name => {
    const entry = reads.find(([key]) => key === `${name}:SKILL.md`)?.[1];
    return !entry ? 'unread' : entry.complete ? 'complete' : 'partial';
  };
  return { executionContractRevision: revision, approvalMode: session.approvalMode === 'auto' ? 'auto' : 'ask',
    taskOpsReadState: state('solopi-desktop-task-ops'), cliReadState: state('solopi-desktop-cli') };
}
module.exports = { revision, frame, metadata };

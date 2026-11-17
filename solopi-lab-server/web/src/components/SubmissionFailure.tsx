import type {SubmissionFailure as Failure} from '../api/submission-failure';
import {PageHeaderActions} from './PageHeaderActions';
import {BackLink} from './BackLink';
export function SubmissionFailure({task,onRefresh}:{task:Failure;onRefresh:()=>void}){
 return <section className="submission-failure"><PageHeaderActions><BackLink href="#/tasks">全部任务</BackLink><button onClick={onRefresh}>刷新状态</button></PageHeaderActions><h2>{task.name}</h2><p role="status">提交校验未通过 · 未执行</p><p>设备组：{task.group.name} · 已执行 0 / {task.cases.length} 条用例</p><div role="alert"><h3>请修复以下用例后重新提交</h3>{task.report.validation.validationErrors.map((e,i)=><article key={i}><strong>{e.caseName||task.cases.find(c=>c.caseId===e.caseId)?.name||e.caseId||'用例配置'}</strong><p>{e.message||e.code}</p><small>{[e.caseId,e.node,e.code].filter(Boolean).join(' · ')}</small></article>)}</div><p>任务在设备执行前被拦截，未生成执行报告、日志或录屏。</p></section>;
}

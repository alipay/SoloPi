import { useLanguage } from '../language';
import { ArrowDown, ArrowUp, ArrowRightLeft } from 'lucide-react';

export function WorkflowCleanupToolbar({region, count, readOnly, movable, onRegionChange, onMove, onReorder}: {
  region:'main'|'cleanup'; count:number; readOnly:boolean; movable:boolean;
  onRegionChange:(region:'main'|'cleanup')=>void; onMove:()=>void; onReorder:(direction:number)=>void;
}) {
  const { t } = useLanguage();
  return <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2" data-testid="workflow-cleanup-toolbar">
    <div role="tablist" aria-label="执行区域" className="flex gap-1">
      {(['main','cleanup'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={region === value}
        onClick={()=>onRegionChange(value)} className={`rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${region === value ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>
        {value === 'main' ? t("业务流程", "Main workflow") : `${t('Final 清理区域', 'Final cleanup')} (${count})`}
      </button>)}
    </div>
    {region === 'cleanup' && <span className="text-xs text-slate-600">{t("成功、失败或停止后，按顺序执行全部清理节点。", "Run cleanup steps in order after completion, failure, or cancellation.")}</span>}
    {!readOnly && movable && <div className="ml-auto flex items-center gap-1">
      {region === 'cleanup' && <>
        <button type="button" aria-label="清理节点前移" onClick={()=>onReorder(-1)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100"><ArrowUp size={16}/></button>
        <button type="button" aria-label="清理节点后移" onClick={()=>onReorder(1)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100"><ArrowDown size={16}/></button>
      </>}
      <button type="button" onClick={onMove} className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        <ArrowRightLeft size={14}/>{region === 'main' ? t("移入清理区域", "Move to cleanup") : t("移回业务流程", "Move to main workflow")}
      </button>
    </div>}
  </div>;
}

import { useLanguage } from '../language';
import { Info } from 'lucide-react';

/** Keep routine local/repository differences beside the case name, out of the editor canvas. */
export function CaseLibrarySyncHint({ libraryName, hasLocalChanges, busy, onCompare }: {
  libraryName?: string;
  hasLocalChanges: boolean;
  busy: boolean;
  onCompare: () => void;
}) {
  const { t } = useLanguage();

  return <details className="relative shrink-0" onClick={event => event.stopPropagation()}>
    <summary aria-label={hasLocalChanges ? t("本地修改未同步，点击查看说明", "Local changes are unsynced. Click for details.") : t("查看用例同步说明", "View case sync information")}
      title={hasLocalChanges ? t("本地修改未同步，点击查看说明", "Local changes are unsynced. Click for details.") : t("查看用例同步说明", "View case sync information")}
      className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 [&::-webkit-details-marker]:hidden">
      <Info aria-hidden="true" className="h-4 w-4" />
    </summary>
    <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[70vw] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg">
      <p className="text-xs font-bold text-slate-700">{hasLocalChanges ? t("本地修改未同步", "Local changes are unsynced") : t("用例同步说明", "Case sync information")}{libraryName ? ` · ${libraryName}` : ''}</p>
      <p className="mt-2 whitespace-normal text-xs font-normal leading-relaxed text-slate-500">
        {hasLocalChanges
          ? t("当前应用内容与仓库版本不同，本地修改已保存。可继续编辑，按需同步到仓库；刷新不会覆盖本地修改。", "Local changes differ from the repository and are saved. Edit or sync them when ready. Refreshing keeps local changes.")
          : t("用例可以在本地编辑，再按需同步到仓库。刷新用例会重新读取本地库，不会执行 Git 拉取或上传。", "Edit cases locally and sync them to the repository when ready. Refresh reloads the local library without pulling or uploading.")}
      </p>
      {hasLocalChanges && <button type="button" disabled={busy} onClick={onCompare}
        className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
        {busy ? t("比较中…", "Comparing…") : t("重新比较", "Compare again")}
      </button>}
    </div>
  </details>;
}

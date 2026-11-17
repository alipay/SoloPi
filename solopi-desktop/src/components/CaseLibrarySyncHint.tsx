import { Info } from 'lucide-react';

/** Keep routine local/repository differences beside the case name, out of the editor canvas. */
export function CaseLibrarySyncHint({ libraryName, hasLocalChanges, busy, onCompare }: {
  libraryName?: string;
  hasLocalChanges: boolean;
  busy: boolean;
  onCompare: () => void;
}) {
  return <details className="relative shrink-0" onClick={event => event.stopPropagation()}>
    <summary aria-label={hasLocalChanges ? '本地修改未同步，点击查看说明' : '查看用例同步说明'}
      title={hasLocalChanges ? '本地修改未同步，点击查看说明' : '查看用例同步说明'}
      className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 [&::-webkit-details-marker]:hidden">
      <Info aria-hidden="true" className="h-4 w-4" />
    </summary>
    <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[70vw] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg">
      <p className="text-xs font-bold text-slate-700">{hasLocalChanges ? '本地修改未同步' : '用例同步说明'}{libraryName ? ` · ${libraryName}` : ''}</p>
      <p className="mt-2 whitespace-normal text-xs font-normal leading-relaxed text-slate-500">
        {hasLocalChanges
          ? '当前应用内容与仓库版本不同，本地修改已保存。可继续编辑，按需同步到仓库；刷新不会覆盖本地修改。'
          : '用例可以在本地编辑，再按需同步到仓库。刷新用例会重新读取本地库，不会执行 Git 拉取或上传。'}
      </p>
      {hasLocalChanges && <button type="button" disabled={busy} onClick={onCompare}
        className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
        {busy ? '比较中…' : '重新比较'}
      </button>}
    </div>
  </details>;
}

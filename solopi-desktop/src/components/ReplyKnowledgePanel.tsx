import { useEffect, useState } from 'react';
import { FilePlus2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';

type Document = { id: string; name: string; characters: number; status: string };
type Editor = { id?: string; name: string; text: string };
const errors: Record<string, string> = {
  empty_document: '文档没有可提取的文字；扫描图片型 PDF 暂不支持。',
  file_too_large: '文件或解压内容过大。',
  text_too_large: '文档文字过长。',
  too_many_pages: 'PDF 页数超过上限。',
  invalid_pdf: 'PDF 文件格式不正确。',
  invalid_or_encrypted_pdf: '无法解析 PDF，请检查文件是否损坏或加密。',
  invalid_docx: '无法解析 DOCX，请检查文件格式。',
  invalid_text_encoding: '文本文件必须使用 UTF-8 编码。',
  invalid_name: '请输入不超过 255 字的名称。',
  unsupported_file_type: '不支持此文件类型。',
  document_not_found: '文档不存在，请刷新列表。',
  knowledge_records_unavailable: '知识记录不可用，自动回复已停止检索。请检查知识库。',
  unsafe_record: '该记录无法安全删除，请检查本地知识库目录及文件权限。',
};

export default function ReplyKnowledgePanel() {
  const [items, setItems] = useState<Document[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invoke = async (channel: string, args?: unknown) => {
    if (!window.glassbox?.ipcRenderer) throw new Error('请在桌面应用中使用知识库。');
    const result = await window.glassbox.ipcRenderer.invoke(channel, args);
    if (!result?.success) throw new Error(errors[result?.error] || '操作失败，请检查文件及权限。');
    return result.value;
  };
  const refresh = async () => setItems(await invoke('reply-knowledge:list'));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败。'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void run(refresh); }, []);

  return <section className="space-y-3 border-t border-slate-200 pt-4" aria-label="回复知识库">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-slate-900">本地知识库</h3><p className="mt-1 text-xs text-slate-500">支持 TXT、Markdown、文字 PDF 和 DOCX。检索命中的片段会随消息发送给所选模型。</p></div>
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setEditor({ name: '', text: '' })} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-40"><Plus size={14}/>新建</button><button type="button" disabled={busy} onClick={() => void run(async () => { await invoke('reply-knowledge:import'); await refresh(); })} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-40"><FilePlus2 size={14}/>导入文档</button></div>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!items.length && !error && <p className="text-xs text-slate-500">暂无文档</p>}
    {items.some(item => item.status === 'unavailable') && <p role="alert" className="text-xs text-red-600">部分知识记录损坏或权限异常，自动回复无法检索。请删除不可用记录后重新导入；删除前请保留原始文档。</p>}
    <ul className="divide-y divide-slate-100">{items.map(item => <li key={item.id} className="flex items-center gap-2 py-2 text-sm"><div className="min-w-0 flex-1"><div className="break-words">{item.name}</div><div className="text-xs text-slate-500">{item.status === 'indexed' ? `已索引 · ${item.characters} 字符` : `不可用 · 记录 ${item.id}`}</div></div>{item.status === 'indexed' && <button type="button" disabled={busy} aria-label={`编辑 ${item.name}`} title="编辑" className="rounded p-1 hover:bg-slate-100 disabled:opacity-40" onClick={() => void run(async () => setEditor(await invoke('reply-knowledge:get', item.id)))}><Pencil size={15}/></button>}<button type="button" disabled={busy} aria-label={`删除 ${item.name}`} title="删除" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40" onClick={() => { if (window.confirm(`删除文档“${item.name}”？`)) void run(async () => { await invoke('reply-knowledge:remove', item.id); if (editor?.id === item.id) setEditor(null); await refresh(); }); }}><Trash2 size={15}/></button></li>)}</ul>
    {editor && <div className="space-y-2 border-t border-slate-200 pt-3"><label className="block text-xs text-slate-600">名称<input aria-label="文档名称" value={editor.name} maxLength={255} onChange={e => setEditor({ ...editor, name: e.target.value })} className="mt-1 w-full rounded border px-2 py-2 text-sm"/></label><label className="block text-xs text-slate-600">正文<textarea aria-label="文档正文" value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })} rows={8} className="mt-1 w-full rounded border px-2 py-2 text-sm"/></label><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void run(async () => { await invoke('reply-knowledge:save', editor); setEditor(null); await refresh(); })} className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-40"><Save size={14}/>保存</button><button type="button" disabled={busy} onClick={() => setEditor(null)} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs"><X size={14}/>取消</button></div></div>}
  </section>;
}

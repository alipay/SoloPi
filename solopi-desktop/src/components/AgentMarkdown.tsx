import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseDocument, stringify } from 'yaml';

function skillMetadata(source: string) {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { body: source };
  try {
    const document = parseDocument(match[1]);
    if (document.errors.length) throw new Error('Invalid metadata');
    const value = document.toJS({ maxAliasCount: 0 });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected metadata mapping');
    return { body: source.slice(match[0].length), rows: Object.entries(value).map(([key, value]) => ({
      key, value: typeof value === 'string' ? value : value == null ? 'null' : typeof value === 'object' ? stringify(value).trimEnd() : String(value),
    })) };
  } catch {
    // Malformed frontmatter remains readable as literal data, never a Markdown heading.
    return { body: source.slice(match[0].length), raw: match[1] };
  }
}

export default function AgentMarkdown({ children, showMetadata = false }: { children: string; showMetadata?: boolean }) {
  const { body, rows, raw } = showMetadata ? skillMetadata(children) : { body: children };
  return <>
    {(rows || raw !== undefined) && <section aria-label="Skill metadata" className="my-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
      <h4 className="mb-4 text-sm font-medium text-slate-500">Metadata</h4>
      {rows ? <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,0.32fr)_minmax(0,1fr)] sm:gap-y-3">
        {rows.map(row => <div key={row.key} className="contents">
          <dt className="min-w-0 break-words font-mono text-slate-500">{row.key}</dt>
          <dd className="mb-2 min-w-0 whitespace-pre-wrap break-words font-mono leading-relaxed text-slate-800 [overflow-wrap:anywhere] sm:mb-0">{row.value}</dd>
        </div>)}
      </dl> : <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-slate-700">{raw}</pre>}
    </section>}
    <div className="prose prose-sm prose-slate max-w-none break-words prose-p:my-3 prose-headings:mt-5 prose-headings:mb-2 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:before:content-none prose-code:after:content-none prose-table:text-xs">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//i.test(href)) void window.glassbox?.ipcRenderer.invoke('shell:open-external', href); }}>{children}</a>,
      img: ({ alt }) => <span className="text-slate-500">[图片：{alt || '未加载'}]</span>,
      table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
    }}>{body}</ReactMarkdown>
  </div></>;
}

import { useLanguage } from '../language';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyValueButton({ value, label }: { value: string; label: string }) {
  const { t } = useLanguage();

  const [feedback, setFeedback] = useState({ value: '', label: '', message: '', copied: false });
  const message = feedback.value === value && feedback.label === label ? feedback.message : '';
  const available = Boolean(value.trim()) && value.trim() !== '-';
  useEffect(() => {
    if (!feedback.message) return;
    const timer = setTimeout(() => setFeedback({ value: '', label: '', message: '', copied: false }), 2000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return <>
    <button type="button" disabled={!available} aria-label={t(`复制${label}`, `Copy ${label}`)}
      title={message || (available ? t(`复制完整${label}`, `Copy full ${label}`) : t(`暂无${label}可复制`, `No ${label} to copy`))}
      className="nodrag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
      onClick={async event => {
        event.stopPropagation();
        if (!available) return;
        try {
          await navigator.clipboard.writeText(value);
          setFeedback({ value, label, message: t(`已复制${label}`, `Copied ${label}`), copied: true });
        } catch {
          setFeedback({ value, label, message: t(`复制${label}失败，请手动复制`, `Could not copy ${label}. Copy it manually.`), copied: false });
        }
      }}>
      {message && feedback.copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
    <span role="status" className="sr-only">{message}</span>
  </>;
}

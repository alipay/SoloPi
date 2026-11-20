import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Keep the measured space while expensive, offscreen report content is unmounted. */
export default function ReportViewport({ children, estimate = 300, label, className }: {
  children: () => ReactNode; estimate?: number; label: string; className?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const height = useRef(estimate);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === target);
      if (entry) setVisible(entry.isIntersecting);
    }, { rootMargin: '500px 200px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const target = element.current;
    if (!visible || !target) return;
    const measure = () => { height.current = Math.max(1, target.getBoundingClientRect().height); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => { measure(); observer.disconnect(); };
  }, [visible]);
  return <div ref={element} className={className} aria-label={label} style={visible ? undefined : { height: height.current }}>
    {visible ? children() : <div className="p-4 text-xs text-slate-400">{label}</div>}
  </div>;
}

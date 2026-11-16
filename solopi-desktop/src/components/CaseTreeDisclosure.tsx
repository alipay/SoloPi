import { ChevronRight } from 'lucide-react';

export function CaseTreeDisclosure({ expanded }: { expanded: boolean }) {
  return <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />;
}

export function toggleTreeBranch(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export type ChatScrollMetrics = { top: number; height: number; viewport: number };
export function chatScrollMetrics(viewport: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): ChatScrollMetrics {
  return { top: viewport.scrollTop, height: viewport.scrollHeight, viewport: viewport.clientHeight };
}
// A layout-induced scroll must not revoke follow mode before ResizeObserver
// can restore the bottom. User upward gestures clear following before this runs.
export function chatScrollUpdate(previous: ChatScrollMetrics | null, current: ChatScrollMetrics, following: boolean) {
  const distance = Math.max(0, current.height - current.viewport - current.top);
  const layoutChanged = previous !== null && (previous.height !== current.height || previous.viewport !== current.viewport);
  if (following && layoutChanged) return { following: true, scrollToBottom: true, showJump: false };
  return { following: distance < 80, scrollToBottom: false, showJump: distance > 160 };
}

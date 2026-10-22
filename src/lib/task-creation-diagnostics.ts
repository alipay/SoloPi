type Bridge = {ipcRenderer?: {invoke: (channel: string, payload: unknown) => Promise<unknown>}} | null | undefined;
export function createTaskCreationAttempt(api: Bridge, source: string, metadata: Record<string, unknown>) {
  const id = globalThis.crypto?.randomUUID?.() || `creation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const record = (stage: 'clicked' | 'rejected' | 'accepted' | 'ignored', details: Record<string, unknown> = {}) => {
    try { void Promise.resolve(api?.ipcRenderer?.invoke('workflow-task:creation-event', {...metadata, ...details, creationId: id, creationSource: source, stage})).catch(() => {}); } catch { /* Diagnostics must not block submission. */ }
  };
  record('clicked');
  return {id, source, record};
}

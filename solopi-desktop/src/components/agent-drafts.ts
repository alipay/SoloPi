import { useCallback, useSyncExternalStore } from 'react';

type Draft = { text: string; attachments: File[]; revision: number; sending: boolean };
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
const storageKey = (id: string) => `solopi-desktop.agent-draft.${id}`;
function read(id: string): Draft {
  let draft = drafts.get(id);
  if (!draft) {
    let text = '';
    try { text = sessionStorage.getItem(storageKey(id)) || ''; } catch { /* memory still preserves navigation */ }
    draft = { text, attachments: [], revision: 0, sending: false };
    drafts.set(id, draft);
  }
  return draft;
}
function update(id: string, patch: Partial<Draft>, edited = true) {
  const prior = read(id);
  const next = { ...prior, ...patch, revision: prior.revision + Number(edited) };
  drafts.set(id, next);
  try {
    if (next.text) sessionStorage.setItem(storageKey(id), next.text);
    else sessionStorage.removeItem(storageKey(id));
  } catch { /* storage denial must not discard the in-memory draft */ }
  listeners.forEach(listener => listener());
}
export const agentDrafts = {
  read,
  setText(id: string, value: string | ((previous: string) => string)) {
    update(id, { text: typeof value === 'function' ? value(read(id).text) : value });
  },
  setAttachments(id: string, value: File[] | ((previous: File[]) => File[])) {
    update(id, { attachments: typeof value === 'function' ? value(read(id).attachments) : value });
  },
  beginSend(id: string) {
    const draft = read(id);
    if (draft.sending) return null;
    update(id, { sending: true }, false);
    return draft;
  },
  finishSend(id: string, revision: number, success: boolean) {
    const draft = read(id);
    update(id, success && draft.revision === revision
      ? { sending: false, text: '', attachments: [] } : { sending: false }, false);
  },
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useAgentDraft(id: string) {
  const snapshot = useCallback(() => read(id), [id]);
  const draft = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    ...draft,
    setText: useCallback((value: string | ((previous: string) => string)) => agentDrafts.setText(id, value), [id]),
    setAttachments: useCallback((value: File[] | ((previous: File[]) => File[])) => agentDrafts.setAttachments(id, value), [id]),
  };
}

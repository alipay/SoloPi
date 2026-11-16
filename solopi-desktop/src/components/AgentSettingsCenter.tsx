import { useCallback, useEffect, useState } from 'react';
import AgentExtensions from './AgentExtensions';
import AgentRequestSettings from './AgentRequestSettings';
import ReplyAutomationSettings from './ReplyAutomationSettings';
import type { AgentModel } from './agent-turns';

export type AgentSettingsSection = 'agent-request' | 'agent-reply' | 'agent-extensions';

export default function AgentSettingsCenter({ section, sessionId }: { section: AgentSettingsSection; sessionId: string }) {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const api = window.glassbox?.ipcRenderer;
  const invoke = useCallback(async (channel: string, payload: Record<string, unknown> = {}) => {
    if (!api) throw Error('请通过桌面应用打开设置中心');
    const result = await api.invoke(channel, payload);
    if (!result || result.success === false) throw Error(result?.error || '读取设置失败');
    return result;
  }, [api]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshSessions = () => {
      void invoke('agent:list').then(result => {
        if (active) setBusy(!Array.isArray(result.sessions) || result.sessions.some((session: { status?: string }) =>
          session.status === 'running' || session.status === 'awaiting_approval'));
      }).catch(() => { if (active) setBusy(true); });
    };
    refreshSessions();
    if (section === 'agent-reply') void invoke('agent:models').then(result => {
      if (active) { setModels(Array.isArray(result.models) ? result.models : []); setError(''); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '无法读取模型'); });
    const changed = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; refreshSessions(); }, 250);
    };
    api?.on('agent:changed', changed);
    return () => { active = false; if (timer) clearTimeout(timer); api?.removeListener('agent:changed', changed); };
  }, [api, invoke, section]);

  if (section === 'agent-extensions') return <AgentExtensions embedded invoke={invoke} />;
  if (section === 'agent-request') return <AgentRequestSettings embedded id={sessionId || undefined} busy={busy} />;
  return <>{error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}<ReplyAutomationSettings embedded models={models} /></>;
}

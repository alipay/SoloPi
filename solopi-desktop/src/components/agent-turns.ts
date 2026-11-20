export type AgentMessage = { createdAt?: string; attachments?: {id:string;name:string;path:string;size:number;mime:string}[]; role: string; content?: string | null; reasoning_content?: string; tool_calls?: { id: string }[] };
export type AgentCall = { id: string; modelCallId?: string; name: string; status: string; args: unknown; result?: unknown; detailsAvailable?: boolean };
export function agentTurns(messages: AgentMessage[], calls: AgentCall[], status: string) {
  const turns: { start: number; user?: AgentMessage; messages: AgentMessage[]; calls: AgentCall[]; active: boolean; final?: AgentMessage }[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'user' || !turns.length) turns.push({ start: index, user: message.role === 'user' ? message : undefined, messages: [], calls: [], active: false });
    if (message.role !== 'user') turns.at(-1)!.messages.push(message);
  });
  const callMap = new Map(calls.filter(c=>c.modelCallId).map(c=>[c.modelCallId,c]));
  for (const turn of turns) {
    const ids = new Set(turn.messages.flatMap(m => m.tool_calls?.map(c => c.id) || []));
    turn.calls = [...ids].flatMap(id=>callMap.has(id)?[callMap.get(id)!]:[]);
    turn.active = turn === turns.at(-1) && ['running','awaiting_approval','waiting'].includes(status);
    const last = turn.messages.at(-1);
    if (!turn.active && last?.role === 'assistant' && !last.tool_calls?.length && last.content) turn.final = last;
  }
  return turns;
}

export type AgentModel = { id: string; name: string; model: string };
export function modelOptions(models: AgentModel[]) {
  return models.map(p => ({ id: p.id, label: models.filter(other => other.model === p.model).length > 1 ? `${p.name} · ${p.model}` : p.model }));
}

export function turnTimeline(turn: ReturnType<typeof agentTurns>[number]) {
  const calls = new Map(turn.calls.map(c => [c.modelCallId, c]));
  return turn.messages.filter(m => m.role === 'assistant').map((message, index) => ({
    index, message,
    calls: (message.tool_calls || []).flatMap(c => calls.has(c.id) ? [calls.get(c.id)!] : []),
  })).filter(row => row.message !== turn.final || !!row.message.reasoning_content || row.calls.length > 0);
}

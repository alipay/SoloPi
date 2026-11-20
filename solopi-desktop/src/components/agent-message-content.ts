import type { AgentMessage } from './agent-turns';
/** Hide only the generated attachment suffix, never arbitrary user-written paths. */
export function messageDisplayText(message: AgentMessage): string {
  const text = message.content || '';
  const attachments = message.attachments || [];
  if (!attachments.length) return text;
  const suffixes = [
    '\n\n附件（资料）：\n' + attachments.map(a => a.name + ' — ' + a.path).join('\n'),
    '\n附件（资料）:\n' + attachments.map(a => a.name + ': ' + a.path).join('\n'),
    '\n' + attachments.map(a => a.path).join('\n'),
  ];
  const suffix = suffixes.find(value => text.endsWith(value));
  return suffix ? text.slice(0, -suffix.length).trimEnd() : text;
}

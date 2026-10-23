export function moveQuickAction<T extends { id: string }>(actions: T[], sourceId: string, targetId: string, after: boolean): T[] {
  const source = actions.find((action) => action.id === sourceId);
  if (!source || sourceId === targetId || !actions.some((action) => action.id === targetId)) return actions;
  const next = actions.filter((action) => action.id !== sourceId);
  const index = next.findIndex((action) => action.id === targetId);
  next.splice(index + (after ? 1 : 0), 0, source);
  return next;
}

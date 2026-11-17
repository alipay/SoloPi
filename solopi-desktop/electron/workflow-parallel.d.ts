export interface ParallelHint { status: 'valid' | 'invalid'; label: string; detail: string; }
export interface ParallelPresentation {
  nodes: Record<string, ParallelHint[]>;
  edges: Record<string, ParallelHint>;
  groups: Array<{source: string; target?: string; status: string; detail?: string}>;
}
export function parallelPresentation(steps: readonly {id: string; type: string; componentId?: string; config?: Record<string, unknown>}[], edges: readonly {id?: string; source: string; target: string}[], components?: Record<string, unknown>): ParallelPresentation;
export function decorateParallelEdges<T>(edges: readonly T[], presentation: ParallelPresentation, runtimeLabels?: Record<string, string>): T[];

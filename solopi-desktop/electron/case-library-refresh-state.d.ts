export interface LibraryRefreshState {
  cases?: unknown;
  caseEdges?: unknown;
  components?: unknown;
  caseFolders?: unknown;
  nodePositions?: unknown;
  caseLibraries?: { id?: string; repoUrl?: string; branch?: string; gitBranch?: string; localRepoPath?: string; localComponentIds?: string[] }[];
}
export function captureLibraryRefreshState(state: LibraryRefreshState): string;
export function assertLibraryRefreshState(snapshot: string, latest: LibraryRefreshState): void;

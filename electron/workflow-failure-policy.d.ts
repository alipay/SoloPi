export const ASSERTION_KINDS: Set<string>;
export function normalizeCaseFailurePolicy<T>(testCase: T, components?: readonly { id: string; kind?: string }[]): T;
export function normalizeStateFailurePolicies<T>(state: T): T;

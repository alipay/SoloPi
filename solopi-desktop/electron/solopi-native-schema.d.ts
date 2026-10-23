export const ACTION_CODES: Record<string, string>;
export const INPUT_ACTIONS: Set<string>;
export const REQUIRED_PARAMS: Record<string, string[]>;
export function nativeCaseIssues(document: unknown, inputs?: Record<string, unknown>): Array<{index: number; action?: string; reason: string}>;
export function applyNativeInputs(document: unknown, inputs?: Record<string, unknown>): any;

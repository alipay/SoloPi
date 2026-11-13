export type MobileUiTapPosition = 'relative' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export function normalizeMobileUiTapPosition(value: unknown): MobileUiTapPosition;
export function normalizeMobileUiTapInset(value: unknown, fallback?: number): number;

export function getMobileUiTapPoint(
  rect: { left?: number; top?: number; right?: number; bottom?: number },
  position?: MobileUiTapPosition | string,
  insetX?: number,
  insetY?: number,
  ratioX?: unknown,
  ratioY?: unknown,
): { x: number; y: number };

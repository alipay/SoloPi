const MOBILE_UI_TAP_POSITIONS = new Set([
  'center',
  'relative',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

function normalizeMobileUiTapPosition(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return MOBILE_UI_TAP_POSITIONS.has(normalized) ? normalized : 'center';
}

function normalizeMobileUiTapInset(value, fallback = 5) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? Math.max(0, fallbackNumber) : 5;
  if (value === '' || value === null || value === undefined) return safeFallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : safeFallback;
}

function getMobileUiTapPoint(rect, position = 'center', insetX = 5, insetY = insetX, ratioX = 0.5, ratioY = 0.5) {
  const left = Number(rect?.left || 0);
  const top = Number(rect?.top || 0);
  const right = Number(rect?.right || left);
  const bottom = Number(rect?.bottom || top);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (position === 'relative') {
    const x = Number(ratioX), y = Number(ratioY);
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('元素内点击比例必须在 0 到 1 之间');
    return { x: Math.round(left + width * x), y: Math.round(top + height * y) };
  }
  const safeInsetX = Math.min(normalizeMobileUiTapInset(insetX), width / 2);
  const safeInsetY = Math.min(normalizeMobileUiTapInset(insetY), height / 2);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  const points = {
    center: { x: centerX, y: centerY },
    'top-left': { x: left + safeInsetX, y: top + safeInsetY },
    'top-right': { x: right - safeInsetX, y: top + safeInsetY },
    'bottom-left': { x: left + safeInsetX, y: bottom - safeInsetY },
    'bottom-right': { x: right - safeInsetX, y: bottom - safeInsetY },
  };
  const point = points[normalizeMobileUiTapPosition(position)];
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

module.exports = {
  getMobileUiTapPoint,
  normalizeMobileUiTapInset,
  normalizeMobileUiTapPosition,
};

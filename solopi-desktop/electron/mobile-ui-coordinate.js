function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function parseAndroidWindowMetrics(output) {
  const text = String(output || '');
  const readSize = (label) => {
    const match = text.match(new RegExp(`${label}\\s*size\\s*:\\s*(\\d+)x(\\d+)`, 'i'));
    return match
      ? { width: Number(match[1]), height: Number(match[2]) }
      : null;
  };
  const physical = readSize('Physical');
  const override = readSize('Override');
  const first = text.match(/(\d+)x(\d+)/);
  const fallback = first
    ? { width: Number(first[1]), height: Number(first[2]) }
    : null;
  const logical = override || physical || fallback || { width: 0, height: 0 };

  return {
    width: logical.width,
    height: logical.height,
    source: override ? 'override' : physical ? 'physical' : fallback ? 'wm-size' : 'unknown',
    physical,
    override,
  };
}

function parsePngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseAndroidDisplayRotation(output) {
  const text = String(output || '');
  const patterns = [
    /SurfaceOrientation\s*:\s*([0-3])/i,
    /mCurrentOrientation\s*=\s*(?:ROTATION_)?([0-3])/i,
    /\brotation\s*=\s*(?:ROTATION_)?([0-3])/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return 0;
}

function inferUiSize(elements = [], fallback = {}) {
  const maxRight = elements.reduce((max, item) => Math.max(max, Number(item?.rect?.right || 0)), 0);
  const maxBottom = elements.reduce((max, item) => Math.max(max, Number(item?.rect?.bottom || 0)), 0);
  return {
    width: toPositiveInteger(fallback.width) || toPositiveInteger(maxRight),
    height: toPositiveInteger(fallback.height) || toPositiveInteger(maxBottom),
  };
}

function createMobileUiCoordinateSpace({ elements = [], windowMetrics = {}, screenshotSize = null, rotation = 0 } = {}) {
  const ui = inferUiSize(elements, windowMetrics);
  const screenshot = {
    width: toPositiveInteger(screenshotSize?.width) || ui.width,
    height: toPositiveInteger(screenshotSize?.height) || ui.height,
  };
  const normalizedRotation = Number(rotation) >= 0 && Number(rotation) <= 3 ? Number(rotation) : 0;
  const orientationMismatch = ui.width > 0
    && ui.height > 0
    && screenshot.width > 0
    && screenshot.height > 0
    && (ui.width > ui.height) !== (screenshot.width > screenshot.height);
  const mode = orientationMismatch && normalizedRotation === 1
    ? 'rotate-90'
    : orientationMismatch && normalizedRotation === 3
      ? 'rotate-270'
      : 'scale';

  return {
    ui,
    screenshot,
    rotation: normalizedRotation,
    mode,
    scaleX: ui.width > 0 ? screenshot.width / ui.width : 1,
    scaleY: ui.height > 0 ? screenshot.height / ui.height : 1,
  };
}

function mapUiPointToScreenshot(point, coordinateSpace) {
  const ui = coordinateSpace?.ui || {};
  const screenshot = coordinateSpace?.screenshot || {};
  const uiWidth = toPositiveInteger(ui.width);
  const uiHeight = toPositiveInteger(ui.height);
  const screenshotWidth = toPositiveInteger(screenshot.width);
  const screenshotHeight = toPositiveInteger(screenshot.height);
  const x = Number(point?.x || 0);
  const y = Number(point?.y || 0);
  if (!uiWidth || !uiHeight || !screenshotWidth || !screenshotHeight) return { x, y };

  if (coordinateSpace.mode === 'rotate-90') {
    return {
      x: y * screenshotWidth / uiHeight,
      y: (uiWidth - x) * screenshotHeight / uiWidth,
    };
  }
  if (coordinateSpace.mode === 'rotate-270') {
    return {
      x: (uiHeight - y) * screenshotWidth / uiHeight,
      y: x * screenshotHeight / uiWidth,
    };
  }
  return {
    x: x * screenshotWidth / uiWidth,
    y: y * screenshotHeight / uiHeight,
  };
}

function mapUiRectToScreenshot(rect, coordinateSpace) {
  if (!rect) return null;
  const points = [
    mapUiPointToScreenshot({ x: rect.left, y: rect.top }, coordinateSpace),
    mapUiPointToScreenshot({ x: rect.right, y: rect.top }, coordinateSpace),
    mapUiPointToScreenshot({ x: rect.left, y: rect.bottom }, coordinateSpace),
    mapUiPointToScreenshot({ x: rect.right, y: rect.bottom }, coordinateSpace),
  ];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

module.exports = {
  createMobileUiCoordinateSpace,
  inferUiSize,
  mapUiPointToScreenshot,
  mapUiRectToScreenshot,
  parseAndroidDisplayRotation,
  parseAndroidWindowMetrics,
  parsePngDimensions,
};

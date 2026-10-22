// Element-relative single swipe. SoloPi's SCROLL_TO_TOP means a finger swipe
// upwards, not a loop that scrolls until the beginning of a page.
function getMobileUiElementSwipe(rect, screen, config = {}) {
  const { left, top, right, bottom } = rect || {};
  const width = right - left, height = bottom - top;
  const screenWidth = Number(screen?.width), screenHeight = Number(screen?.height);
  const ratioX = Number(config.tapRatioX ?? 0.5), ratioY = Number(config.tapRatioY ?? 0.5);
  const percent = Number(config.distancePercent ?? 100), duration = Number(config.swipeDurationMs ?? 300);
  if (![left, top, right, bottom, screenWidth, screenHeight].every(Number.isFinite) || width <= 0 || height <= 0 || screenWidth <= 20 || screenHeight <= 80) throw Error('元素滑动缺少有效区域或屏幕尺寸');
  if (![ratioX, ratioY].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw Error('元素滑动起点比例必须在 0 到 1 之间');
  if (!Number.isInteger(percent) || percent <= 0 || percent > 10000 || !Number.isInteger(duration) || duration < 1 || duration > 10000) throw Error('元素滑动距离或时长无效');
  const direction = config.direction;
  if (!['up', 'down', 'left', 'right'].includes(direction)) throw Error('元素滑动方向无效');
  const clampX = n => Math.max(10, Math.min(screenWidth - 10, n));
  const clampY = n => Math.max(40, Math.min(screenHeight - 40, n));
  // The source recorder uses Java float arithmetic before casting to int.
  const fromX = clampX(Math.trunc(Math.fround(left + Math.fround(width * Math.fround(ratioX)))));
  const fromY = clampY(Math.trunc(Math.fround(top + Math.fround(height * Math.fround(ratioY)))));
  const distance = Math.trunc(Math.fround(Math.fround(percent / 100) * (['up', 'down'].includes(direction) ? height : width)));
  const toX = clampX(fromX + (direction === 'left' ? -distance : direction === 'right' ? distance : 0));
  const toY = clampY(fromY + (direction === 'up' ? -distance : direction === 'down' ? distance : 0));
  if (fromX === toX && fromY === toY) throw Error('元素滑动起终点重合，未执行无效手势');
  return { fromX, fromY, toX, toY, duration };
}
module.exports = { getMobileUiElementSwipe };

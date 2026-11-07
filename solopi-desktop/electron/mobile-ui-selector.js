function normalizeMobileSelector(selector = {}) {
  if (typeof selector === 'string') {
    try {
      return normalizeMobileSelector(JSON.parse(selector));
    } catch (_error) {
      return normalizeMobileSelector({ text: selector });
    }
  }

  return {
    resourceId: String(selector.resourceId || '').trim(),
    text: String(selector.text || '').trim(),
    contentDesc: String(selector.contentDesc || '').trim(),
    className: String(selector.className || '').trim(),
    bounds: String(selector.bounds || '').trim(),
    xRatio: String(selector.xRatio || '').trim(),
    yRatio: String(selector.yRatio || '').trim(),
  };
}

function mobileTextMatches(actual, expected, matchMode) {
  const actualText = String(actual || '');
  const expectedText = String(expected || '');

  if (!expectedText) {
    return true;
  }

  if (matchMode === 'contains' || matchMode === 'auto') {
    return actualText === expectedText || actualText.includes(expectedText);
  }

  return actualText === expectedText;
}

function findMobileUiElement(elements = [], selector = {}, matchMode = 'auto') {
  const normalizedSelector = normalizeMobileSelector(selector);
  const explicitTextMode = matchMode === 'exact' || matchMode === 'contains';
  const enabledElements = elements.filter((item) => item.enabled !== false);
  const withScore = enabledElements.map((item) => {
    let score = 0;
    let hardMismatch = false;

    if (normalizedSelector.resourceId) {
      if (item.resourceId === normalizedSelector.resourceId || item.resourceId.endsWith(`:id/${normalizedSelector.resourceId}`)) {
        score += 100;
      } else {
        hardMismatch = true;
      }
    }

    if (normalizedSelector.text) {
      if (mobileTextMatches(item.text, normalizedSelector.text, matchMode)) {
        score += item.text === normalizedSelector.text ? 80 : 56;
      } else if (explicitTextMode || !normalizedSelector.resourceId) {
        hardMismatch = true;
      }
    }

    if (normalizedSelector.contentDesc) {
      if (mobileTextMatches(item.contentDesc, normalizedSelector.contentDesc, matchMode)) {
        score += item.contentDesc === normalizedSelector.contentDesc ? 76 : 52;
      } else if (explicitTextMode || (!normalizedSelector.resourceId && !normalizedSelector.text)) {
        hardMismatch = true;
      }
    }

    if (normalizedSelector.className) {
      if (item.className === normalizedSelector.className) {
        score += 18;
      } else if (!normalizedSelector.resourceId && !normalizedSelector.text && !normalizedSelector.contentDesc) {
        hardMismatch = true;
      }
    }

    if (matchMode === 'bounds' && (!normalizedSelector.bounds || item.bounds !== normalizedSelector.bounds)) hardMismatch = true;
    if (normalizedSelector.bounds && item.bounds === normalizedSelector.bounds) {
      score += 12;
    }

    return { item, score: hardMismatch ? -1 : score };
  }).filter((entry) => entry.score > 0);

  withScore.sort((first, second) => {
    if (second.score !== first.score) {
      return second.score - first.score;
    }
    return Number(second.item.clickable) - Number(first.item.clickable);
  });

  return withScore[0]?.item || null;
}

module.exports = {
  findMobileUiElement,
  mobileTextMatches,
  normalizeMobileSelector,
};

function escapeRegExpText(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createJsonExtractRegexFromSample(sampleLog, selectedPayload) {
  const source = sampleLog.trim();
  const payload = selectedPayload.trim();

  if (!source || !payload) {
    return '';
  }

  const start = source.indexOf(payload);

  if (start < 0) {
    return '';
  }

  const before = source.slice(0, start);
  const after = source.slice(start + payload.length);
  const escapedBefore = escapeRegExpText(before);
  const escapedAfter = escapeRegExpText(after);

  // JSON punctuation can also occur inside the selected payload. A lazy
  // wildcard ending at a comma captures only the first property. Retain the
  // selected container boundaries, then verify against the full selection.
  const isContainer = (payload.startsWith('{') && payload.endsWith('}')) || (payload.startsWith('[') && payload.endsWith(']'));
  let capture = escapedAfter ? '([\\s\\S]*?)' : '([\\s\\S]*)';
  if (payload.startsWith('{') && payload.endsWith('}')) capture = '(\\{[\\s\\S]*\\})';
  else if (payload.startsWith('[') && payload.endsWith(']')) capture = '(\\[[\\s\\S]*\\])';
  const pattern = `${escapedBefore}${capture}${escapedAfter}`;
  const match = new RegExp(pattern).exec(source);
  if (match?.[1] !== payload) return '';
  if (isContainer) { try { parseLogJsonPayload(match[1]); } catch { return ''; } }
  return pattern;
}

function createTtsExtractRegexFromSelection(sampleLog, selectedText) {
  const source = sampleLog.trim();
  const target = selectedText.trim();

  if (!source || !target || !source.includes(target)) {
    return '';
  }

  const index = source.indexOf(target);
  const prefix = source.slice(0, index);
  const suffix = source.slice(index + target.length);

  if (suffix) {
    return `${escapeRegExpText(prefix)}(?<ttsText>.*?)${escapeRegExpText(suffix)}`;
  }

  return `${escapeRegExpText(prefix)}(?<ttsText>.*?)(?:[\\r\\n]|$)`;
}

function extractJsonCandidate(text) {
  const raw = String(text || '').trim();

  if (!raw) {
    return '';
  }

  if (raw.startsWith('{') || raw.startsWith('[')) {
    return raw;
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }

  return raw;
}

function parseMaybeJsonString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return value;
  }
}

function deepParseJsonStrings(value, depth = 0) {
  if (depth > 8) {
    return value;
  }

  const parsedValue = parseMaybeJsonString(value);

  if (Array.isArray(parsedValue)) {
    return parsedValue.map((item) => deepParseJsonStrings(item, depth + 1));
  }

  if (parsedValue && typeof parsedValue === 'object') {
    return Object.fromEntries(
      Object.entries(parsedValue).map(([key, item]) => [key, deepParseJsonStrings(item, depth + 1)])
    );
  }

  return parsedValue;
}

function parseLogJsonPayload(rawText) {
  const candidate = extractJsonCandidate(rawText);

  if (!candidate) {
    throw new Error('命中的日志中没有可解析的 JSON 内容');
  }

  try {
    return deepParseJsonStrings(JSON.parse(candidate));
  } catch (error) {
    throw new Error(`JSON 日志解析失败：${error.message}`);
  }
}

function parseJsonAssertConditions(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return [value];
  }

  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    throw new Error(`条件 JSON 解析失败：${error.message}`);
  }
}

function parseSimpleJsonPath(pathExpression) {
  const normalized = String(pathExpression || '')
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');
  return normalized.split('.').map((segment) => segment.trim()).filter(Boolean);
}

function getJsonPathValue(source, pathExpression) {
  const segments = parseSimpleJsonPath(pathExpression);

  if (segments.length === 0) {
    return source;
  }

  return segments.reduce((current, key) => (
    current && typeof current === 'object' ? current[key] : undefined
  ), source);
}

function findJsonPathValueDeep(source, pathExpression) {
  const exact = getJsonPathValue(source, pathExpression);

  if (exact !== undefined) {
    return exact;
  }

  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const queue = Array.isArray(source) ? [...source] : Object.values(source);

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== 'object') {
      continue;
    }

    const value = getJsonPathValue(current, pathExpression);

    if (value !== undefined) {
      return value;
    }

    queue.push(...(Array.isArray(current) ? current : Object.values(current)));
  }

  return undefined;
}

function assertJsonCondition(root, condition) {
  const pathExpression = String(condition.path || '').trim();
  const operator = String(condition.operator || 'equals').trim();
  const actualValue = findJsonPathValueDeep(root, pathExpression);
  const expectedValue = condition.value;

  if (operator === 'notExists') {
    if (actualValue !== undefined && actualValue !== null && actualValue !== '') {
      const actualText = actualValue && typeof actualValue === 'object' ? JSON.stringify(actualValue) : String(actualValue);
      throw new Error(`字段不应存在：${pathExpression}，实际「${actualText}」`);
    }

    return {
      path: pathExpression,
      operator,
      actual: actualValue,
      expected: expectedValue,
    };
  }

  if (operator === 'exists') {
    if (actualValue === undefined || actualValue === null || actualValue === '') {
      throw new Error(`字段不存在或为空：${pathExpression}`);
    }

    return {
      path: pathExpression,
      operator,
      actual: actualValue,
      expected: expectedValue,
    };
  }

  if (actualValue === undefined) {
    throw new Error(`字段不存在：${pathExpression}`);
  }

  const ignoreCase = condition.ignoreCase === true || String(condition.ignoreCase || '').toLowerCase() === 'true';
  const actualText = actualValue && typeof actualValue === 'object' ? JSON.stringify(actualValue) : String(actualValue);
  const expectedText = expectedValue && typeof expectedValue === 'object' ? JSON.stringify(expectedValue) : String(expectedValue ?? '');
  const actualComparable = ignoreCase ? actualText.toLowerCase() : actualText;
  const expectedComparable = ignoreCase ? expectedText.toLowerCase() : expectedText;

  if (operator === 'contains') {
    if (!actualComparable.includes(expectedComparable)) {
      throw new Error(`字段 ${pathExpression} 不包含期望值：期望包含「${expectedText}」，实际「${actualText}」`);
    }
  } else if (operator === 'notContains') {
    if (actualComparable.includes(expectedComparable)) {
      throw new Error(`字段 ${pathExpression} 不应包含期望值：不应包含「${expectedText}」，实际「${actualText}」`);
    }
  } else if (operator === 'regex') {
    const regexp = new RegExp(expectedText, ignoreCase ? 'i' : '');

    if (!regexp.test(actualText)) {
      throw new Error(`字段 ${pathExpression} 不匹配正则：${expectedText}，实际「${actualText}」`);
    }
  } else if (operator === 'notRegex') {
    const regexp = new RegExp(expectedText, ignoreCase ? 'i' : '');

    if (regexp.test(actualText)) {
      throw new Error(`字段 ${pathExpression} 不应匹配正则：${expectedText}，实际「${actualText}」`);
    }
  } else if (operator === 'notEquals') {
    if (actualComparable === expectedComparable) {
      throw new Error(`字段 ${pathExpression} 不应等于「${expectedText}」`);
    }
  } else if (actualComparable !== expectedComparable) {
    throw new Error(`字段 ${pathExpression} 不一致：期望「${expectedText}」，实际「${actualText}」`);
  }

  return {
    path: pathExpression,
    operator,
    actual: actualValue,
    expected: expectedValue,
  };
}


module.exports = { createJsonExtractRegexFromSample, createTtsExtractRegexFromSelection, parseLogJsonPayload, parseJsonAssertConditions, assertJsonCondition, findJsonPathValueDeep };

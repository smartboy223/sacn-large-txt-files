/**
 * Query parser and line matcher for AND/OR/NOT/LIKE (mirrors Smart_search.py logic).
 */

function normalizeQueryText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitByOperator(query, operator) {
  const re = new RegExp('\\b' + operator + '\\b', 'gi');
  return query.split(re);
}

function parseQuery(queryText) {
  const q = normalizeQueryText(queryText);
  if (!q) return { type: 'empty', conditions: [] };

  const operators = ['OR', 'AND', 'NOT'];
  const hasOp = operators.some(op => q.toUpperCase().includes(op)) || q.includes('(');
  if (!hasOp) {
    const keywords = q.split(',').map(k => k.trim()).filter(Boolean);
    if (keywords.length > 1) {
      return { type: 'or', conditions: keywords.map(kw => ({ type: 'keyword', value: kw })) };
    }
    if (keywords.length === 1) return { type: 'keyword', value: keywords[0] };
  }

  return parseComplexQuery(q.replace(/[()]/g, ''));
}

function parseComplexQuery(query) {
  query = query.trim();
  const orParts = splitByOperator(query, 'OR');
  if (orParts.length > 1) {
    return {
      type: 'or',
      conditions: orParts.map(p => parseComplexQuery(p.trim())),
    };
  }
  const andParts = splitByOperator(query, 'AND');
  if (andParts.length > 1) {
    return {
      type: 'and',
      conditions: andParts.map(p => parseComplexQuery(p.trim())),
    };
  }
  if (/^not\s+/i.test(query)) {
    return {
      type: 'not',
      condition: parseComplexQuery(query.slice(4).trim()),
    };
  }
  const likeParts = splitByOperator(query, 'LIKE');
  if (likeParts.length === 2) {
    return {
      type: 'like',
      keyword: likeParts[0].trim(),
      pattern: likeParts[1].trim(),
    };
  }
  return { type: 'keyword', value: query };
}

function buildMatcher(condition, caseSensitive, regexMode) {
  const type = condition.type || 'keyword';
  if (type === 'keyword') {
    const raw = (condition.value || '').trim();
    if (regexMode) {
      try {
        const re = new RegExp(raw, caseSensitive ? 'g' : 'gi');
        return line => re.test(line);
      } catch (_) {
        const kw = caseSensitive ? raw : raw.toLowerCase();
        return line => (caseSensitive ? line : line.toLowerCase()).includes(kw);
      }
    }
    if (raw.includes('*')) {
      const pattern = raw.split(/\*+/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      try {
        const re = new RegExp(pattern, caseSensitive ? '' : 'i');
        return line => re.test(line);
      } catch (_) {
        const kw = caseSensitive ? raw : raw.toLowerCase();
        return line => (caseSensitive ? line : line.toLowerCase()).includes(kw);
      }
    }
    const kw = caseSensitive ? raw : raw.toLowerCase();
    return line => {
      const l = caseSensitive ? line : line.toLowerCase();
      return l.includes(kw);
    };
  }
  if (type === 'and') {
    const subs = (condition.conditions || []).map(c => buildMatcher(c, caseSensitive, regexMode));
    return line => subs.every(m => m(line));
  }
  if (type === 'or') {
    const subs = (condition.conditions || []).map(c => buildMatcher(c, caseSensitive, regexMode));
    return line => subs.some(m => m(line));
  }
  if (type === 'not') {
    const inner = buildMatcher(condition.condition, caseSensitive, regexMode);
    return line => !inner(line);
  }
  if (type === 'like') {
    const k = caseSensitive ? condition.keyword : condition.keyword.toLowerCase();
    const p = caseSensitive ? condition.pattern : condition.pattern.toLowerCase();
    return line => {
      const l = caseSensitive ? line : line.toLowerCase();
      return l.includes(k) && l.includes(p);
    };
  }
  if (type === 'empty') return () => true;
  return () => false;
}

function getKeywords(condition, set) {
  const type = condition.type || 'keyword';
  if (type === 'keyword') {
    if (condition.value) set.add(condition.value);
    return;
  }
  if (type === 'and' || type === 'or') {
    (condition.conditions || []).forEach(c => getKeywords(c, set));
    return;
  }
  if (type === 'not') {
    getKeywords(condition.condition, set);
    return;
  }
  if (type === 'like') {
    if (condition.keyword) set.add(condition.keyword);
    if (condition.pattern) set.add(condition.pattern);
  }
}

/**
 * Extract keywords that MUST appear on a line for it to ever match the query.
 * Used for a cheap pre-filter before the full matcher runs.
 *
 *   keyword       → [keyword]
 *   AND(a, b, c)  → [a, b, c]  (all must be present)
 *   OR(a, b)      → []         (either could match — can't require either)
 *   NOT(x)        → []         (any non-x line could match)
 *   LIKE(k, p)    → [k, p]     (both must appear)
 *   empty         → []
 */
function extractMandatoryKeywords(condition) {
  if (!condition) return [];
  const type = condition.type || 'keyword';
  if (type === 'keyword') {
    const v = (condition.value || '').trim();
    // wildcards and regex can't be used as plain substrings
    if (!v || v.includes('*') || v.includes('(') || v.includes('|')) return [];
    return [v];
  }
  if (type === 'and') {
    // all branches are required → union all mandatory keywords
    const result = [];
    for (const c of (condition.conditions || [])) {
      result.push(...extractMandatoryKeywords(c));
    }
    return result;
  }
  if (type === 'or') {
    // any branch could satisfy the query → no mandatory keyword
    return [];
  }
  if (type === 'not') {
    // NOT x → any line without x could match → no mandatory keyword
    return [];
  }
  if (type === 'like') {
    const result = [];
    if (condition.keyword && condition.keyword.trim()) result.push(condition.keyword.trim());
    if (condition.pattern && condition.pattern.trim()) result.push(condition.pattern.trim());
    return result;
  }
  return [];
}

function compileMatcher(parsedQuery, caseSensitive, regexMode) {
  return buildMatcher(parsedQuery, caseSensitive, !!regexMode);
}

module.exports = {
  normalizeQueryText,
  parseQuery,
  compileMatcher,
  getKeywords,
  extractMandatoryKeywords,
};

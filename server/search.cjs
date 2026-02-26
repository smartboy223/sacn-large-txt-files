const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseQuery, compileMatcher, getKeywords, extractMandatoryKeywords } = require('./searchParser.cjs');

// ---------------------------------------------------------------------------
// Abort flag (shared across all concurrent file workers)
// ---------------------------------------------------------------------------
let searchAbort = false;
function setSearchAbort(value) { searchAbort = value; }
function getSearchAbort() { return searchAbort; }

// ---------------------------------------------------------------------------
// Exclude checker — built once, reused across all files
// ---------------------------------------------------------------------------
function buildExcludeChecker(excludeKeywords, caseSensitive) {
  if (!excludeKeywords || excludeKeywords.length === 0) return null;
  if (caseSensitive) {
    return line => excludeKeywords.some(ex => line.includes(ex));
  }
  const lower = excludeKeywords.map(ex => ex.toLowerCase());
  return line => {
    const l = line.toLowerCase();
    return lower.some(ex => l.includes(ex));
  };
}

// ---------------------------------------------------------------------------
// Pre-filter: fast mandatory-keyword check on the raw line (no allocation)
// Returns true if the line can possibly match (passes the pre-filter).
// Returns false if it definitely cannot match → skip immediately.
// ---------------------------------------------------------------------------
function buildPreFilter(mustContainRaw, mustContainLower, caseSensitive) {
  if (!mustContainRaw || mustContainRaw.length === 0) return null; // no pre-filter possible
  if (caseSensitive) {
    return rawLine => mustContainRaw.every(kw => rawLine.includes(kw));
  }
  // Case-insensitive: check both original and lowercased keyword against the raw line.
  // Avoids calling rawLine.toLowerCase() until at least one keyword passes.
  return rawLine => {
    for (let i = 0; i < mustContainLower.length; i++) {
      // indexOf is faster than includes for tight loops in V8
      if (rawLine.indexOf(mustContainLower[i]) === -1 &&
          rawLine.indexOf(mustContainRaw[i]) === -1) {
        return false;
      }
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Search a single file — returns a Promise that resolves when the file is done.
// Shared `state` object carries the mutable counters (total, processedBytes, abort).
// ---------------------------------------------------------------------------
function searchOneFile(fp, fileSize, opts) {
  const {
    matcher,
    preFilter,
    checkExclude,
    caseSensitive,
    wordPatterns,
    maxResults,
    state,
    onResult,
    onProgress,
    totalBytes,
  } = opts;

  return new Promise((resolve) => {
    if (state.abort || state.total >= maxResults) { resolve(); return; }

    let lineNum = 0;
    let lastProgressBytes = state.processedBytes;
    const PROGRESS_INTERVAL = 8 * 1024 * 1024; // report every ~8 MB

    let rl;
    try {
      rl = readline.createInterface({
        input: fs.createReadStream(fp, { highWaterMark: 8 * 1024 * 1024 }),
        crlfDelay: Infinity,
      });
    } catch (err) {
      onResult({ line: null, content: `Error opening ${path.basename(fp)}: ${err.message}`, file: fp });
      state.processedBytes += fileSize;
      resolve();
      return;
    }

    const processLine = (rawLine) => {
      if (state.abort || state.total >= maxResults) return;

      lineNum++;

      // ── [A] Mandatory-keyword pre-filter (cheapest possible check) ──────────
      // Uses raw line, no allocation. Skips ~99% of lines on typical data files.
      if (preFilter && !preFilter(rawLine)) {
        // update processedBytes approximation
        state.processedBytes += rawLine.length + 1;
        return;
      }

      // ── [B] Exclude pre-filter (before any allocation) ──────────────────────
      if (checkExclude) {
        // For case-insensitive we need the lower line — but only for the few
        // lines that survived the pre-filter, so the cost is acceptable.
        const testLine = caseSensitive ? rawLine : rawLine.toLowerCase();
        if (checkExclude(testLine)) {
          state.processedBytes += rawLine.length + 1;
          return;
        }
      }

      // ── [C] Strip \r — char-code check instead of regex ─────────────────────
      const line = rawLine.charCodeAt(rawLine.length - 1) === 13
        ? rawLine.slice(0, -1) : rawLine;

      state.processedBytes += rawLine.length + 1; // approximate bytes (avoids Buffer.byteLength)

      if (!line) return;

      // ── Progress throttle ────────────────────────────────────────────────────
      if (state.processedBytes - lastProgressBytes >= PROGRESS_INTERVAL) {
        lastProgressBytes = state.processedBytes;
        if (onProgress) onProgress(state.processedBytes, totalBytes, fp);
      }

      // ── [D] Whole-word pre-check ─────────────────────────────────────────────
      if (wordPatterns && wordPatterns.length > 0) {
        const testLine = caseSensitive ? line : line.toLowerCase();
        if (!wordPatterns.some(re => re.test(testLine))) return;
      }

      // ── [E] Full matcher (AND/OR/NOT/LIKE) ───────────────────────────────────
      const evalLine = caseSensitive ? line : line.toLowerCase();
      if (!matcher(evalLine)) return;

      // ── [F] Emit result ──────────────────────────────────────────────────────
      state.total++;
      onResult({ line: lineNum, content: line, file: fp });
    };

    rl.on('line', processLine);

    rl.on('close', () => {
      // Mark the whole file as processed in case we exited early
      state.processedBytes = Math.max(state.processedBytes, state.processedBytes);
      if (onProgress) onProgress(state.processedBytes, totalBytes, fp);
      resolve();
    });

    rl.on('error', (err) => {
      onResult({ line: null, content: `Error reading ${path.basename(fp)}: ${err.message}`, file: fp });
      state.processedBytes += fileSize;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function runSearch(params, onResult, onProgress, onDone) {
  const {
    query,
    exclude = '',
    maxResults = 1000,
    options = {},
    basePath,
    filePaths = [],
    concurrency,        // optional override (default 4)
  } = params;

  setSearchAbort(false);

  const parsedQuery = parseQuery(query);
  const excludeList = exclude.split(',').map(s => s.trim()).filter(Boolean);

  const caseSensitive = options.caseSensitive || false;
  const wholeWord     = options.wholeWord     || false;
  const regex         = options.regex         || false;

  // ── Build matchers once (reused across all files) ──────────────────────────
  const matcher      = compileMatcher(parsedQuery, caseSensitive, regex);
  const checkExclude = buildExcludeChecker(excludeList, caseSensitive);

  // Mandatory-keyword pre-filter arrays
  const mustContainRaw   = extractMandatoryKeywords(parsedQuery);
  const mustContainLower = mustContainRaw.map(k => k.toLowerCase());
  const preFilter        = buildPreFilter(mustContainRaw, mustContainLower, caseSensitive);

  // Whole-word patterns (only when not regex/wildcard)
  const keywords = new Set();
  getKeywords(parsedQuery, keywords);
  const hasWildcardOrRegex = regex || [...keywords].some(k => k && k.includes('*'));
  const wordPatterns = wholeWord && !hasWildcardOrRegex
    ? [...keywords].filter(Boolean).map(k =>
        new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
          caseSensitive ? 'g' : 'gi'))
    : null;

  // ── Collect files ───────────────────────────────────────────────────────────
  let filesToSearch = Array.isArray(filePaths) && filePaths.length ? filePaths : [];
  if (filesToSearch.length === 0 && basePath) {
    try {
      const excludedNames = new Set(['refined_results.txt', 'search_results.txt']);
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.txt') && !excludedNames.has(e.name.toLowerCase())) {
          filesToSearch.push(path.join(basePath, e.name));
        }
      }
    } catch (err) {
      onDone({ error: err.message });
      return;
    }
  }

  // ── Cache file sizes (one stat pass) ───────────────────────────────────────
  const fileSizeMap = new Map();
  let totalBytes = 0;
  for (const fp of filesToSearch) {
    try {
      const size = fs.statSync(fp).size;
      fileSizeMap.set(fp, size);
      totalBytes += size;
    } catch (_) {
      fileSizeMap.set(fp, 0);
    }
  }

  // ── Shared mutable state across concurrent workers ─────────────────────────
  const state = { total: 0, processedBytes: 0, abort: false };

  // Mirror the global abort flag into state on each tick
  const abortPoll = setInterval(() => { if (getSearchAbort()) state.abort = true; }, 100);

  const POOL = Math.min(Math.max(Number(concurrency) || 4, 1), 8);
  const startTime = Date.now();

  try {
    for (let i = 0; i < filesToSearch.length; i += POOL) {
      if (state.abort || state.total >= maxResults) break;

      const batch = filesToSearch.slice(i, i + POOL);
      const workerOpts = {
        matcher,
        preFilter,
        checkExclude,
        caseSensitive,
        wordPatterns,
        maxResults,
        state,
        onResult,
        onProgress,
        totalBytes,
      };

      await Promise.all(
        batch
          .filter(fp => fileSizeMap.has(fp))
          .map(fp => searchOneFile(fp, fileSizeMap.get(fp), workerOpts))
      );

      if (onProgress) onProgress(state.processedBytes, totalBytes, null);
    }
  } catch (err) {
    clearInterval(abortPoll);
    onDone({ error: err.message });
    return;
  }

  clearInterval(abortPoll);
  onDone({ total: state.total, timeMs: Date.now() - startTime });
}

module.exports = {
  setSearchAbort,
  getSearchAbort,
  runSearch,
};

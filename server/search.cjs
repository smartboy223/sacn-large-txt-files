const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { parseQuery, compileMatcher, getKeywords, extractMandatoryKeywords } = require('./searchParser.cjs');

/** Read OS/hardware and return recommended concurrency and stream buffer (MB). Used when env vars are not set. */
function getOsTunedDefaults() {
  const cpus = Math.max(1, (os.cpus && os.cpus()) ? os.cpus().length : 4);
  const totalMem = (os.totalmem && os.totalmem()) || 0;
  const freeMem = (os.freemem && os.freemem()) || 0;
  const gb = 1024 * 1024 * 1024;
  const concurrency = Math.min(Math.max(cpus, 4), 24);
  let streamHwmMB = 8;
  if (totalMem >= 16 * gb && freeMem >= 4 * gb) streamHwmMB = 32;
  else if (totalMem >= 8 * gb && freeMem >= 2 * gb) streamHwmMB = 16;
  else if (totalMem >= 4 * gb) streamHwmMB = 12;
  return { concurrency, streamHwmMB };
}

const osTuned = getOsTunedDefaults();

let searchAbort = false;
function setSearchAbort(value) { searchAbort = value; }
function getSearchAbort() { return searchAbort; }

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

function buildPreFilter(mustContainRaw, mustContainLower, caseSensitive) {
  if (!mustContainRaw || mustContainRaw.length === 0) return null;
  if (caseSensitive) {
    return rawLine => mustContainRaw.every(kw => rawLine.includes(kw));
  }
  return rawLine => {
    const lineToCheck = rawLine.toLowerCase();
    for (let i = 0; i < mustContainLower.length; i++) {
      if (lineToCheck.indexOf(mustContainLower[i]) === -1) return false;
    }
    return true;
  };
}

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
    filesDone,
    totalFiles,
  } = opts;

  const bytesAtStart = state.processedBytes;

  return new Promise((resolve) => {
    if (state.abort || state.total >= maxResults) { resolve(); return; }

    let lineNum = 0;
    let lastProgressBytes = state.processedBytes;
    let fileProcessedBytes = 0;
    const PROGRESS_INTERVAL = opts.progressIntervalBytes ?? 512 * 1024;

    const streamHwm = opts.streamHighWaterMark ?? 8 * 1024 * 1024;
    let rl;
    try {
      rl = readline.createInterface({
        input: fs.createReadStream(fp, { highWaterMark: streamHwm }),
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

      if (preFilter && !preFilter(rawLine)) {
        state.processedBytes += rawLine.length + 1;
        return;
      }

      if (checkExclude) {
        const testLine = caseSensitive ? rawLine : rawLine.toLowerCase();
        if (checkExclude(testLine)) {
          state.processedBytes += rawLine.length + 1;
          return;
        }
      }

      const line = rawLine.charCodeAt(rawLine.length - 1) === 13
        ? rawLine.slice(0, -1) : rawLine;

      const lineBytes = rawLine.length + 1;
      state.processedBytes += lineBytes;
      fileProcessedBytes += lineBytes;

      if (!line) return;

      if (state.processedBytes - lastProgressBytes >= PROGRESS_INTERVAL) {
        lastProgressBytes = state.processedBytes;
        const filePct = fileSize > 0 ? Math.min(100, Math.round((fileProcessedBytes / fileSize) * 100)) : 0;
        if (onProgress) onProgress(state.processedBytes, totalBytes, fp, filePct, filesDone, totalFiles);
      }

      if (wordPatterns && wordPatterns.length > 0) {
        const testLine = caseSensitive ? line : line.toLowerCase();
        if (!wordPatterns.some(re => re.test(testLine))) return;
      }

      const evalLine = caseSensitive ? line : line.toLowerCase();
      if (!matcher(evalLine)) return;

      state.total++;
      onResult({ line: lineNum, content: line, file: fp });
    };

    if (onProgress) onProgress(state.processedBytes, totalBytes, fp, 0, filesDone, totalFiles);

    rl.on('line', processLine);

    rl.on('close', () => {
      const filePct = 100;
      if (onProgress) onProgress(state.processedBytes, totalBytes, fp, filePct, filesDone, totalFiles);
      resolve();
    });

    rl.on('error', (err) => {
      onResult({ line: null, content: `Error reading ${path.basename(fp)}: ${err.message}`, file: fp });
      state.processedBytes += fileSize;
      resolve();
    });
  });
}

async function runSearch(params, onResult, onProgress, onDone) {
  const {
    query,
    exclude = '',
    maxResults = 1000,
    options = {},
    basePath,
    filePaths = [],
    concurrency,
  } = params;

  setSearchAbort(false);

  const parsedQuery = parseQuery(query);
  const excludeList = exclude.split(',').map(s => s.trim()).filter(Boolean);

  const caseSensitive = options.caseSensitive || false;
  const wholeWord     = options.wholeWord     || false;
  const regex         = options.regex         || false;

  const matcher      = compileMatcher(parsedQuery, caseSensitive, regex);
  const checkExclude = buildExcludeChecker(excludeList, caseSensitive);

  const mustContainRaw   = regex ? [] : extractMandatoryKeywords(parsedQuery);
  const mustContainLower = mustContainRaw.map(k => k.toLowerCase());
  const preFilter        = buildPreFilter(mustContainRaw, mustContainLower, caseSensitive);

  const keywords = new Set();
  getKeywords(parsedQuery, keywords);
  const hasWildcardOrRegex = regex || [...keywords].some(k => k && k.includes('*'));
  const wordPatterns = wholeWord && !hasWildcardOrRegex
    ? [...keywords].filter(Boolean).map(k =>
        new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
          caseSensitive ? 'g' : 'gi'))
    : null;

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

  const state = { total: 0, processedBytes: 0, abort: false };

  const abortPoll = setInterval(() => { if (getSearchAbort()) state.abort = true; }, 100);

  const defaultPool = Math.min(Math.max(Number(concurrency) || osTuned.concurrency, 1), 32);
  const POOL = defaultPool;
  const startTime = Date.now();

  const envHwm = process.env.SEARCH_STREAM_HWM_MB ? parseInt(process.env.SEARCH_STREAM_HWM_MB, 10) : null;
  const streamHwmMB = envHwm != null && !isNaN(envHwm)
    ? Math.min(Math.max(envHwm, 2), 64)
    : osTuned.streamHwmMB;
  const streamHighWaterMark = streamHwmMB * 1024 * 1024;
  const progressIntervalBytes = 512 * 1024; // 512KB – fewer progress callbacks

  const totalFiles = filesToSearch.length;
  if (onProgress && totalFiles > 0) onProgress(0, totalBytes, null, 0, 0, totalFiles);

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
        filesDone: i,
        totalFiles,
        streamHighWaterMark,
        progressIntervalBytes,
      };

      await Promise.all(
        batch
          .filter(fp => fileSizeMap.has(fp))
          .map(fp => searchOneFile(fp, fileSizeMap.get(fp), workerOpts))
      );

      if (onProgress) onProgress(state.processedBytes, totalBytes, null, 100, i + batch.length, totalFiles);
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

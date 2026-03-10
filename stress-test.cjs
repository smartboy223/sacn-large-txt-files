/**
 * Stress test for production readiness: large data, all query types.
 * Run: node stress-test.cjs [--quick] [--size=MB] [--files=N]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runSearch, setSearchAbort } = require('./server/search.cjs');

const args = process.argv.slice(2).reduce((acc, a) => {
  if (a === '--quick') acc.quick = true;
  else if (a.startsWith('--size=')) acc.sizeMB = parseInt(a.split('=')[1], 10) || 200;
  else if (a.startsWith('--files=')) acc.files = Math.max(1, parseInt(a.split('=')[1], 10) || 20);
  return acc;
}, { quick: false, sizeMB: 200, files: 20 });

if (args.quick) { args.sizeMB = 50; args.files = 5; }

const TMP_DIR = path.join(os.tmpdir(), 'search_stress_' + Date.now());
const BYTES_PER_FILE = Math.max(1024 * 1024, Math.floor((args.sizeMB * 1024 * 1024) / args.files));

function formatBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  return (n / 1e3).toFixed(2) + ' KB';
}

function generateTestFile(filePath, targetBytes) {
  let written = 0;
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  let id = 0;
  return new Promise((resolve, reject) => {
    function writeChunk() {
      let ok = true;
      while (written < targetBytes && ok) {
        const s = 'id:' + id + ' url:https://example.com/user:user' + id + ' pass:secret' + id + ' domain:test.com\n';
        id++;
        ok = stream.write(s);
        written += Buffer.byteLength(s, 'utf8');
      }
      if (written >= targetBytes) { stream.end(); return; }
      stream.once('drain', writeChunk);
    }
    stream.on('finish', () => resolve({ bytes: written }));
    stream.on('error', reject);
    writeChunk();
  });
}

function runSearchPromise(params) {
  return new Promise((resolve, reject) => {
    const results = [];
    runSearch(params, (r) => results.push(r), () => {}, (done) => {
      if (done.error) reject(new Error(done.error));
      else resolve({ results, timeMs: done.timeMs });
    });
  });
}

async function main() {
  console.log('=== Stress Test ===\n');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const testFiles = [];
  for (let i = 0; i < args.files; i++) testFiles.push(path.join(TMP_DIR, 'data_' + i + '.txt'));

  console.log('1. Generating', args.sizeMB, 'MB across', args.files, 'files...');
  const genStart = Date.now();
  let totalBytes = 0;
  for (let i = 0; i < testFiles.length; i++) {
    const target = Math.min(BYTES_PER_FILE, (args.sizeMB * 1024 * 1024) - totalBytes);
    if (target <= 0) break;
    const { bytes } = await generateTestFile(testFiles[i], target);
    totalBytes += bytes;
  }
  console.log('   Done in', ((Date.now() - genStart) / 1000).toFixed(1), 's. Total:', formatBytes(totalBytes), '\n');

  const basePath = TMP_DIR;
  const filePaths = testFiles;
  const tests = [
    { name: 'Empty (5k)', query: '', maxResults: 5000, expectMin: 1 },
    { name: 'Keyword user', query: 'user', maxResults: 10000, expectMin: 1 },
    { name: 'AND user pass', query: 'user AND pass', maxResults: 10000, expectMin: 1 },
    { name: 'OR user domain', query: 'user OR domain', maxResults: 10000, expectMin: 1 },
    { name: 'Exclude junk', query: 'user', exclude: 'junk', maxResults: 10000, expectMin: 0 },
    { name: 'Wildcard', query: 'pass*word', maxResults: 5000, expectMin: 0 },
    { name: 'Regex', query: 'https?://[^\\s]+', options: { regex: true }, maxResults: 5000, expectMin: 1 },
    { name: '50k results', query: 'example', maxResults: 50000, expectMin: 1 },
  ];

  console.log('2. Search stress...');
  let passed = 0, failed = 0;
  for (const t of tests) {
    process.stdout.write('   ' + t.name + '... ');
    try {
      const { results, timeMs } = await runSearchPromise({
        query: t.query, exclude: t.exclude || '', maxResults: t.maxResults,
        options: t.options || {}, basePath, filePaths,
      });
      const ms = timeMs != null ? timeMs : 0;
      if (t.expectMin !== undefined && results.length < t.expectMin) {
        console.log('FAIL (min', t.expectMin, 'got', results.length, ')');
        failed++;
      } else {
        console.log('OK', results.length, 'in', (ms / 1000).toFixed(1) + 's');
        passed++;
      }
    } catch (err) {
      console.log('FAIL', err.message);
      failed++;
    }
  }

  console.log('\n3. Abort test...');
  const abortP = runSearchPromise({ query: 'user', maxResults: 1e6, basePath, filePaths }).then(() => ({ aborted: false })).catch(() => ({ aborted: true }));
  setTimeout(() => setSearchAbort(true), 500);
  const { aborted } = await abortP;
  console.log('   ', aborted ? 'OK (aborted)' : 'completed', '\n');

  console.log('4. Large set 100k...');
  const { results: largeResults, timeMs: largeMs } = await runSearchPromise({
    query: '', maxResults: 100000, basePath, filePaths: filePaths.slice(0, 3),
  });
  console.log('   ', largeResults.length, 'results\n');

  console.log('--- Summary:', passed, 'passed,', failed, 'failed ---');
  try { testFiles.forEach(f => fs.unlinkSync(f)); fs.rmdirSync(TMP_DIR); } catch (_) {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); try { fs.rmSync(TMP_DIR, { recursive: true }); } catch (_) {} process.exit(1); });

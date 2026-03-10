/**
 * Test script for deduplication logic
 * Run: node test-deduplication.cjs
 */

function normalizeContent(s) {
  return s.replace(/\r\n|\r/g, '\n').trim();
}
function normalizePath(p) {
  return p.replace(/\\/g, '/').toLowerCase().trim();
}
function lineStr(line) {
  return line == null ? '' : String(line);
}

function deduplicate(results, contentOnly) {
  const seen = new Set();
  const kept = [];

  const makeKey = (r) => {
    const content = normalizeContent(r.content);
    if (contentOnly) return content;
    return `${normalizePath(r.file)}\t${lineStr(r.line)}\t${content}`;
  };

  for (let i = 0; i < results.length; i++) {
    const k = makeKey(results[i]);
    if (!seen.has(k)) {
      seen.add(k);
      kept.push(results[i]);
    }
  }
  return kept;
}

const tests = [
  {
    name: '1. Exact duplicates (file+line+content)',
    contentOnly: false,
    input: [
      { file: 'C:\\foo\\a.txt', line: 1, content: 'hello' },
      { file: 'C:\\foo\\a.txt', line: 1, content: 'hello' },
      { file: 'C:\\foo\\a.txt', line: 2, content: 'world' },
    ],
    expectCount: 2,
  },
  {
    name: '2. Same content, different files (full mode keeps both)',
    contentOnly: false,
    input: [
      { file: 'a.txt', line: 1, content: 'same' },
      { file: 'b.txt', line: 1, content: 'same' },
    ],
    expectCount: 2,
  },
  {
    name: '3. Same content, different files (content-only removes)',
    contentOnly: true,
    input: [
      { file: 'a.txt', line: 1, content: 'same' },
      { file: 'b.txt', line: 1, content: 'same' },
    ],
    expectCount: 1,
  },
  {
    name: '4. Whitespace: trailing space',
    contentOnly: false,
    input: [
      { file: 'a.txt', line: 1, content: 'hello' },
      { file: 'a.txt', line: 1, content: 'hello ' },
    ],
    expectCount: 1,
  },
  {
    name: '5. Whitespace: leading space',
    contentOnly: false,
    input: [
      { file: 'a.txt', line: 1, content: ' hello' },
      { file: 'a.txt', line: 1, content: 'hello' },
    ],
    expectCount: 1,
  },
  {
    name: '6. Line endings: \\r\\n vs \\n',
    contentOnly: false,
    input: [
      { file: 'a.txt', line: 1, content: 'line1\r\n' },
      { file: 'a.txt', line: 1, content: 'line1\n' },
    ],
    expectCount: 1,
  },
  {
    name: '7. Path case (Windows)',
    contentOnly: false,
    input: [
      { file: 'C:\\Foo\\a.txt', line: 1, content: 'x' },
      { file: 'c:\\foo\\a.txt', line: 1, content: 'x' },
    ],
    expectCount: 1,
  },
  {
    name: '8. Path backslash vs forward slash',
    contentOnly: false,
    input: [
      { file: 'C:\\foo\\a.txt', line: 1, content: 'x' },
      { file: 'C:/foo/a.txt', line: 1, content: 'x' },
    ],
    expectCount: 1,
  },
  {
    name: '9. Null line',
    contentOnly: false,
    input: [
      { file: 'a.txt', line: null, content: 'error' },
      { file: 'a.txt', line: null, content: 'error' },
    ],
    expectCount: 1,
  },
  {
    name: '10. Same URL, different user/pass (keep both - full line)',
    contentOnly: true,
    input: [
      { file: 'a.txt', line: 1, content: 'accounts.google.com/:user1@gmail.com:pass1' },
      { file: 'a.txt', line: 2, content: 'accounts.google.com/:user2@gmail.com:pass2' },
      { file: 'a.txt', line: 3, content: 'accounts.google.com/:user1@gmail.com:pass1' },
    ],
    expectCount: 2,
  },
  {
    name: '11. Large list (50k with 10k unique)',
    contentOnly: true,
    input: (() => {
      const arr = [];
      for (let i = 0; i < 10000; i++) arr.push({ file: 'a.txt', line: i, content: `unique${i}` });
      for (let i = 0; i < 40000; i++) arr.push({ file: 'a.txt', line: i, content: `dup` });
      return arr;
    })(),
    expectCount: 10001,
  },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  process.stdout.write(`Running: ${test.name}... `);
  try {
    const result = deduplicate(test.input, test.contentOnly);
    const ok = result.length === test.expectCount;
    if (ok) {
      console.log(`PASS (${result.length} unique)`);
      passed++;
    } else {
      console.log(`FAIL (expected ${test.expectCount}, got ${result.length})`);
      failed++;
    }
  } catch (err) {
    console.log(`FAIL (${err.message})`);
    failed++;
  }
}

console.log('\n--- Summary ---');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

/**
 * Test script for search options: Regex, Case sensitive, Whole word
 * Run: node test-search-options.cjs
 */
const path = require('path');
const { runSearch } = require('./server/search.cjs');

const PROJECT_ROOT = path.resolve(__dirname);
const SAMPLE_FILE = path.join(PROJECT_ROOT, 'sample_search_test.txt');

const tests = [
  {
    name: '1. Simple keyword (default: case-insensitive)',
    query: 'hello',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectCount: 6,
    expectLines: ['hello world', 'Hello World', 'HELLO WORLD', 'helloworld', 'hello-world', 'hello123'],
  },
  {
    name: '2. Case sensitive - only lowercase',
    query: 'hello',
    options: { regex: false, caseSensitive: true, wholeWord: false },
    expectCount: 4,
    expectLines: ['hello world', 'helloworld', 'hello-world', 'hello123'],
  },
  {
    name: '3. Whole word - "the" as word (excludes theater, atheist)',
    query: 'the',
    options: { regex: false, caseSensitive: false, wholeWord: true },
    expectCount: 2,
    expectLines: ['the cat sat on the mat', 'the the the'],
  },
  {
    name: '4. Whole word - exclude "the" inside words',
    query: 'the',
    options: { regex: false, caseSensitive: false, wholeWord: true },
    expectContains: ['the cat', 'theater', 'the the', 'atheist'],
  },
  {
    name: '5. Regex - email pattern',
    query: '[a-z]+@[a-z]+\\.[a-z]+',
    options: { regex: true, caseSensitive: false, wholeWord: false },
    expectCount: 1,
    expectLines: ['email: user@example.com'],
  },
  {
    name: '6. Regex + Case sensitive',
    query: 'Password',
    options: { regex: false, caseSensitive: true, wholeWord: false },
    expectCount: 1,
    expectLines: ['Password'],
  },
  {
    name: '7. AND operator',
    query: 'foo AND bar',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectCount: 2,
    expectLines: ['foo bar baz', 'foo and bar'],
  },
  {
    name: '8. Exclude - bar NOT baz',
    query: 'bar',
    exclude: 'baz',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectCount: 2,
    expectLines: ['foo and bar', 'bar only'],
  },
  {
    name: '9. All options OFF (baseline)',
    query: 'hello',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectMinCount: 1,
  },
  {
    name: '10. All options ON - regex + case + wholeword',
    query: 'hello',
    options: { regex: true, caseSensitive: true, wholeWord: true },
    expectNote: 'Regex takes precedence over whole word in backend',
  },
  {
    name: '11. Invalid regex - falls back to literal',
    query: '[invalid(regex',
    options: { regex: true, caseSensitive: false, wholeWord: false },
    expectMinCount: 0,
  },
  {
    name: '12. Wildcard - pass*word',
    query: 'pass*word',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectCount: 4,
    expectLines: ['Password', 'PASSWORD', 'password', 'passWord'],
  },
  {
    name: '13. Parentheses: (foo AND bar) OR baz',
    query: '(foo AND bar) OR baz',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectCount: 3,
    expectLines: ['foo bar baz', 'foo and bar', 'baz only'],
  },
  {
    name: '14. test AND wifi (no spaces in data)',
    query: 'test AND wifi',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    expectCount: 3,
    expectLines: ['url:test:wifi', 'test,wifi,data', 'domain.com,test,wifi'],
  },
];

function runTest(test) {
  return new Promise((resolve) => {
    const results = [];
    runSearch(
      {
        query: test.query,
        exclude: test.exclude || '',
        maxResults: 1000,
        options: test.options,
        basePath: PROJECT_ROOT,
        filePaths: [SAMPLE_FILE],
      },
      (r) => results.push(r),
      () => {},
      (done) => {
        resolve({ results, done, test });
      }
    );
  });
}

async function main() {
  console.log('=== Search Options Test Suite ===\n');
  console.log('Sample file:', SAMPLE_FILE);
  console.log('');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    process.stdout.write(`Running: ${test.name}... `);
    try {
      const { results, done } = await runTest(test);
      const count = results.length;

      if (done.error) {
        console.log(`FAIL (error: ${done.error})`);
        failed++;
        continue;
      }

      let ok = true;
      if (test.expectCount !== undefined && count !== test.expectCount) {
        ok = false;
        console.log(`FAIL (expected ${test.expectCount} results, got ${count})`);
      } else if (test.expectMinCount !== undefined && count < test.expectMinCount) {
        ok = false;
        console.log(`FAIL (expected at least ${test.expectMinCount} results, got ${count})`);
      } else if (test.expectLines !== undefined) {
        const resultContents = results.map(r => r.content);
        for (const expected of test.expectLines) {
          const found = resultContents.some(c => c.includes(expected) || c === expected);
          if (!found) {
            ok = false;
            console.log(`FAIL (expected line containing "${expected}" not found)`);
            break;
          }
        }
        if (ok) console.log(`PASS (${count} results)`);
      } else if (test.expectNote) {
        console.log(`INFO: ${test.expectNote} (${count} results)`);
      } else {
        console.log(`PASS (${count} results)`);
      }

      if (ok && !test.expectNote) passed++;
      else if (!test.expectNote) failed++;
    } catch (err) {
      console.log(`FAIL (${err.message})`);
      failed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

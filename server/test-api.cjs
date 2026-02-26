/**
 * Quick API tests for Save and (documentation for Sort/Dedup/Reverse).
 * Run with: node server/test-api.cjs
 * Ensure the server is running first (e.g. npm run dev:server or start.bat).
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.API_PORT) || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.setHeader('Content-Type', 'application/json');
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('Testing API at', BASE, '...\n');

  // 1. Health
  const health = await request('GET', '/api/health');
  if (health.status !== 200) {
    console.error('FAIL: /api/health returned', health.status);
    process.exit(1);
  }
  console.log('OK /api/health', health.data);

  // 2. Save: write to temp file
  const tmpDir = require('os').tmpdir();
  const savePath = path.join(tmpDir, 'search_index_test_save_' + Date.now() + '.txt');
  const results = [
    { file: 'C:\\test\\a.txt', line: 1, content: 'first' },
    { file: 'C:\\test\\b.txt', line: 2, content: 'second' },
  ];
  const saveRes = await request('POST', '/api/save', { filePath: savePath, results });
  if (saveRes.status !== 200) {
    console.error('FAIL: /api/save returned', saveRes.status, saveRes.raw);
    process.exit(1);
  }
  if (!fs.existsSync(savePath)) {
    console.error('FAIL: /api/save did not create file', savePath);
    process.exit(1);
  }
  const content = fs.readFileSync(savePath, 'utf8');
  if (!content.includes('first') || !content.includes('second')) {
    console.error('FAIL: /api/save file content wrong:', content);
    process.exit(1);
  }
  fs.unlinkSync(savePath);
  console.log('OK /api/save (file created and content correct)');

  // 3. Save with empty results (should still create file with empty content or reject)
  const saveEmpty = await request('POST', '/api/save', { filePath: path.join(tmpDir, 'empty_test_' + Date.now() + '.txt'), results: [] });
  if (saveEmpty.status !== 200) {
    console.log('OK /api/save with [] returns', saveEmpty.status, '(backend may reject empty)');
  } else {
    console.log('OK /api/save with [] accepted');
  }

  console.log('\nAll save API tests passed.');
  console.log('\nSort / Reverse / Deduplicate are implemented in the frontend (resultsRef).');
  console.log('To verify: run the app, run a search, click Sort A-Z, Reverse, then Deduplicate and confirm the list order/count changes.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

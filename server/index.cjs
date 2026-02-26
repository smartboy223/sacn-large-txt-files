const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { runSearch, setSearchAbort } = require('./search.cjs');

const app = express();
const PORT = Number(process.env.API_PORT) || 3000;

// Root directory: default = parent of this project (where .txt files live)
const SEARCH_ROOT = path.resolve(process.env.SEARCH_ROOT || path.join(__dirname, '..', '..'));

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- Listing: GET /api/listing?path= ---
// path = absolute directory path (default: SEARCH_ROOT). Can navigate anywhere on the PC.
app.get('/api/listing', (req, res) => {
  const pathParam = req.query.path || req.query.root;
  let reqPath = pathParam && String(pathParam).trim() !== ''
    ? path.resolve(String(pathParam).trim())
    : SEARCH_ROOT;

  try {
    if (!fs.existsSync(reqPath)) {
      return res.status(404).json({ error: `Path does not exist: ${reqPath}` });
    }
    if (!fs.statSync(reqPath).isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }
    const parentDir = path.dirname(reqPath);
    const hasParent = parentDir !== reqPath;
    const entries = fs.readdirSync(reqPath, { withFileTypes: true });
    const folders = [];
    if (hasParent) folders.push({ name: '.. (parent)', path: parentDir });
    for (const e of entries) {
      if (e.isDirectory()) {
        folders.push({ name: e.name, path: path.join(reqPath, e.name) });
      }
    }
    const files = [];
    for (const e of entries) {
      if (e.isFile()) {
        try {
          files.push({ name: e.name, path: path.join(reqPath, e.name), size: fs.statSync(path.join(reqPath, e.name)).size });
        } catch (_) {}
      }
    }
    return res.json({ path: reqPath, folders, files });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Search: POST /api/search (SSE stream) ---
app.post('/api/search', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  const { query, exclude, maxResults, options, basePath, filePaths } = req.body || {};
  const base = (basePath && basePath.trim()) || SEARCH_ROOT;
  const max = Math.min(Number(maxResults) || 1000, 500000);

  runSearch(
    {
      query: query || '',
      exclude: exclude || '',
      maxResults: max,
      options: options || {},
      basePath: base,
      filePaths: filePaths || [],
    },
    result => send('result', result),
    (processedBytes, totalBytes, currentFile) => {
      const pct = totalBytes > 0 ? Math.round((processedBytes / totalBytes) * 100) : 0;
      const file = currentFile ? require('path').basename(currentFile) : null;
      send('progress', { pct, processedBytes, totalBytes, file });
    },
    done => {
      send('done', done);
      res.end();
    }
  );
});

// --- Stop: POST /api/stop ---
app.post('/api/stop', (req, res) => {
  setSearchAbort(true);
  res.json({ ok: true });
});

// --- Save: POST /api/save ---
app.post('/api/save', (req, res) => {
  const { filePath, results, contentOnly } = req.body || {};
  if (!filePath || !Array.isArray(results)) {
    return res.status(400).json({ error: 'filePath and results array required' });
  }
  const fullPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.join(SEARCH_ROOT, filePath);
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const text = contentOnly
      ? results.map(r => r.content).join('\n')
      : results.map(r => `${r.file}\t${r.line}\t${r.content}`).join('\n');
    fs.writeFileSync(fullPath, text, 'utf8');
    return res.json({ ok: true, path: fullPath });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Health + default root (where the server is running)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, root: SEARCH_ROOT });
});

// --- Pick folder (opens native folder dialog, async via spawn) ---
app.post('/api/pick-folder', (req, res) => {
  const { spawn } = require('child_process');
  const os = require('os');
  const tmpOut = path.join(os.tmpdir(), '_pick_folder_' + Date.now() + '.txt');

  if (process.platform === 'win32') {
    // PowerShell + TopMost form so the folder dialog appears in front of the browser
    const tmpPs = tmpOut.replace('.txt', '.ps1');
    const psCode = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.FormBorderStyle = 'None'
$form.Size = New-Object System.Drawing.Size(1,1)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-10000,-10000)
$form.ShowInTaskbar = $false
$form.Show() | Out-Null
$form.Focus() | Out-Null
[System.Windows.Forms.Application]::DoEvents() | Out-Null
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = "Select a folder"
if ($d.ShowDialog($form) -eq "OK") {
  [System.IO.File]::WriteAllText("${tmpOut.replace(/\\/g, '\\\\')}", $d.SelectedPath)
}
$form.Close()
`;
    fs.writeFileSync(tmpPs, psCode, 'utf8');
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', tmpPs], { detached: false, windowsHide: true, stdio: 'ignore' });
    child.on('close', () => {
      let selectedPath = '';
      try { if (fs.existsSync(tmpOut)) { selectedPath = fs.readFileSync(tmpOut, 'utf8').trim(); fs.unlinkSync(tmpOut); } } catch (_) {}
      try { fs.unlinkSync(tmpPs); } catch (_) {}
      if (!selectedPath) return res.json({ path: null });
      selectedPath = path.resolve(selectedPath);
      if (fs.existsSync(selectedPath) && fs.statSync(selectedPath).isDirectory()) {
        return res.json({ path: selectedPath });
      }
      return res.json({ path: null });
    });
    child.on('error', (err) => {
      try { fs.unlinkSync(tmpPs); } catch (_) {}
      return res.status(500).json({ error: err.message });
    });
  } else {
    try {
      const { execSync: es } = require('child_process');
      let sel = '';
      try { sel = es('zenity --file-selection --directory 2>/dev/null', { encoding: 'utf8' }).trim(); } catch (_) {
        sel = es("osascript -e 'choose folder' -e 'return POSIX path of result'", { encoding: 'utf8' }).trim();
      }
      if (sel && fs.existsSync(sel) && fs.statSync(sel).isDirectory()) return res.json({ path: sel });
      return res.json({ path: null });
    } catch (err) {
      return res.json({ path: null });
    }
  }
});

// --- Pick save path (opens native Save As dialog so user chooses where to save) ---
app.post('/api/pick-save-path', (req, res) => {
  const { spawn } = require('child_process');
  const os = require('os');
  const defaultName = (req.body && req.body.defaultName) || 'search_results.txt';
  const tmpOut = path.join(os.tmpdir(), '_pick_save_' + Date.now() + '.txt');

  if (process.platform === 'win32') {
    const tmpPs = tmpOut.replace('.txt', '.ps1');
    const psCode = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.FormBorderStyle = 'None'
$form.Size = New-Object System.Drawing.Size(1,1)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-10000,-10000)
$form.ShowInTaskbar = $false
$form.Show() | Out-Null
$form.Focus() | Out-Null
[System.Windows.Forms.Application]::DoEvents() | Out-Null
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = "Text files (*.txt)|*.txt|All files (*.*)|*.*"
$d.DefaultExt = "txt"
$d.FileName = "${defaultName.replace(/"/g, '`"')}"
$d.Title = "Save search results as"
if ($d.ShowDialog($form) -eq "OK") {
  [System.IO.File]::WriteAllText("${tmpOut.replace(/\\/g, '\\\\')}", $d.FileName)
}
$form.Close()
`;
    fs.writeFileSync(tmpPs, psCode, 'utf8');
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', tmpPs], { detached: false, windowsHide: true, stdio: 'ignore' });
    child.on('close', () => {
      let selectedPath = '';
      try { if (fs.existsSync(tmpOut)) { selectedPath = fs.readFileSync(tmpOut, 'utf8').trim(); fs.unlinkSync(tmpOut); } } catch (_) {}
      try { fs.unlinkSync(tmpPs); } catch (_) {}
      if (selectedPath) selectedPath = path.resolve(selectedPath);
      return res.json({ path: selectedPath || null });
    });
    child.on('error', (err) => {
      try { fs.unlinkSync(tmpPs); } catch (_) {}
      return res.status(500).json({ error: err.message });
    });
  } else {
    try {
      const { execSync: es } = require('child_process');
      let sel = '';
      try { sel = es('zenity --file-selection --save --filename="search_results.txt" 2>/dev/null', { encoding: 'utf8' }).trim(); } catch (_) {
        sel = es("osascript -e 'set f to choose file name with prompt \"Save results as\" default name \"search_results.txt\"' -e 'return POSIX path of f'", { encoding: 'utf8' }).trim();
      }
      if (sel) return res.json({ path: path.resolve(sel) });
      return res.json({ path: null });
    } catch (_) {
      return res.json({ path: null });
    }
  }
});

// Serve static build in production
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(dist, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Advanced Search (local) at http://localhost:${PORT} | default path: ${SEARCH_ROOT}`);
});

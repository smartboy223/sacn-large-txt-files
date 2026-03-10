# 🔍 Scan Large TXT Files

**Stop opening 4GB files in Notepad.** Search across dozens of huge `.txt` files in seconds — with AND, OR, NOT, wildcards, and regex. All on your machine, zero cloud.

---

## 🎯 Why use this instead of the old way?

| ❌ Old way | ✅ This tool |
|------------|--------------|
| Open one file at a time, Ctrl+F, repeat for 20 files | **Search 20+ files at once** — one query, one click |
| Notepad/Excel crashes on multi-GB files | **Streaming** — files never fully loaded, no crash |
| No way to say “password AND email but NOT test” | **Full query syntax**: AND, OR, NOT, LIKE, wildcards, regex |
| Copy-paste from one file, then the next… | **Copy/Save** selected or all results in one go |
| No idea which file had the hit | **See file + line** for every result, sort & dedupe |
| Your data sent to “search engines” or unknown tools | **100% local** — nothing leaves your PC |

So: **faster**, **smarter**, and **private**. One app, any folder, any size.

---

## 🚀 What makes it powerful?

- **⚡ Built for huge files** — Handles 20+ files of several GB each. Streams in 8MB chunks so RAM stays low.
- **🔄 Parallel scan** — Up to 4 files at a time (configurable). Wall-clock time drops by ~4×.
- **🎯 Smart pre-filter** — For queries like `alice AND password`, lines without both terms are skipped before any heavy work. Most lines never touch the full matcher.
- **📋 Query language** — Not just “find word”. Combine keywords with AND, OR, NOT, LIKE, and regex. Exclude junk in one field.
- **🖥️ One UI for everything** — Pick folder, choose files, run query, see progress, copy or save results. No scripts, no CLI to remember.
- **🔒 Your data stays yours** — Runs on localhost. No accounts, no uploads, no telemetry.

---

## 👀 Who is it for?

- **Researchers & analysts** — Comb through big log dumps or export files without opening each one.
- **Devs & admins** — Grep-style search across many configs or logs with a real query language.
- **Anyone with large text datasets** — Credential lists, scrape results, CSV-like exports — if it’s lines of text, this tool can search it.

---

## 📸 See it in action

All screenshots from the app 👇

### 1️⃣ Main interface — search & results

![Main Interface](docs/screenshots/main.png.jpg)

*Directory bar, query & exclude, display toggles, and paginated results.*

---

### 2️⃣ Query autocomplete

![Query suggestions](docs/screenshots/query-suggestions.jpg)

*Type `AND`, `OR`, `NOT`, or `LIKE` and press **Tab** to accept.*

---

### 3️⃣ File browser

![File Browser](docs/screenshots/file-browser.png.jpg)

*Pick which `.txt` files to search. See sizes, Select All / Clear All.*

---

### 4️⃣ Save feedback

![Save toast](docs/screenshots/save-toast.png.jpg)

*After Quick Save you get a clear success (or error) message.*

---

## ✨ Features

### 🔤 Advanced query syntax

| Syntax | Meaning | Example |
|--------|--------|---------|
| `keyword` | Lines containing the keyword | `password` |
| `a, b, c` | Lines containing **any** (OR) | `gmail, hotmail, yahoo` |
| `a AND b` | Lines containing **both** | `password AND email` |
| `a OR b` | Either | `alice OR bob` |
| `NOT x` | Lines **not** containing x | `NOT test` |
| `a AND NOT b` | a but not b | `password AND NOT test` |
| `a LIKE b` | Lines with both a and b | `alice LIKE @gmail.com` |
| `key*word` | Wildcard | `pass*` |
| Regex | Full regex (toggle on) | `\d{3}-\d{4}` |

**Pro tip:** Type `AND`, `OR`, `NOT`, or `LIKE` and press **Tab** to autocomplete.

---

### 📁 File browser & navigation

- **Back / Forward / Up** — Navigate folders like in Explorer.
- **Browse** — Windows folder picker (stays on top of the browser).
- **Files** — Choose exactly which `.txt` files to include in the search.
- **Badge** — Shows file count and total/selected size.

---

### ⚡ Under the hood (why it’s fast)

| Optimization | What it does |
|--------------|--------------|
| **Parallel files** | 4 files scanned at once (1–8 configurable). |
| **Mandatory-keyword pre-filter** | For AND/keyword queries, drop lines missing a term with a single `indexOf` — no extra allocations. |
| **Exclude first** | Excluded keywords checked before the full matcher. |
| **Streaming reads** | 8MB chunks, so multi-GB files don’t fill memory. |
| **Throttled progress** | Progress every ~8MB so the UI stays responsive. |

---

### 🎛️ Search options

| Toggle | What it does |
|--------|----------------|
| **Regex** | Query is a full regular expression. |
| **Case** | Case-sensitive matching. |
| **Word** | Whole-word boundaries only. |
| **Fast** | Parallel scan enabled. |
| **LIVE** | Results stream in as they’re found. |

---

### 📊 Display options

Choose what you see (and what you copy/save):

| Column | Shows |
|--------|--------|
| **#** | Row number in the results list |
| **Line** | Line number in the source file |
| **File** | Source filename |
| **Content Only** | Just the line text (default) |

**Copy & Quick Save** use the same format as the display — content-only or full (file, line, content).

---

### 💾 Buttons & tools

| Button | Action |
|--------|--------|
| **Search** | Run the query |
| **Stop** | Cancel the search |
| **Quick Save** | Download as `search_results.txt` (browser asks where to save) |
| **Copy Sel** | Copy selected rows (or current page) — format matches display |
| **Copy All** | Copy all results — format matches display |
| **Clear** | Clear the results list |

| Tool | Action |
|------|--------|
| **Sort A→Z / Z→A** | Sort by file then line (toggle each click). |
| **Replace** | Find-and-replace in result content. |
| **Deduplicate** | Remove duplicates and see how many were removed. |

---

### 📦 Big result sets

- **Pagination** — 200 results per page so the UI stays smooth even with 500k+ hits.
- **Dedupe** — Shows “Removed N duplicates (M remaining)”.
- **Sort** — One click to flip between A→Z and Z→A.

---

## 🏃 Quick start

### What you need

- **Windows 10/11** (for the native folder picker; search logic works on any OS).
- **Node.js 18+** — [download](https://nodejs.org).

### Run on this PC or any other PC

1. **Copy the whole project folder** to the PC (e.g. via USB, network, or zip).
2. **Install Node.js 18+** if it’s not already installed — [nodejs.org](https://nodejs.org).
3. **Double‑click `start.bat`** in the project folder.

The batch file will:

- Check that Node.js is available (and show an error with a link if not).
- Install dependencies the first time (when `node_modules` is missing).
- Start the API on port **3000** and the app on port **5174**.
- Open the app in your browser after a few seconds.

Closing the command window stops both the API and the app. No config or install steps needed beyond Node.js.

```
📁 project/
├── start.bat     ← double-click to run on any PC
├── package.json
└── ...
```

### Run (Windows)

Same as above: double-click **`start.bat`**.

### Run (any OS, from terminal)

```bash
npm install
npm run dev:all
```

Then open **http://localhost:5174**.

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|--------|-------------|
| `API_PORT` | `3000` | Backend port |
| `PORT` | `5174` | Frontend port |
| `SEARCH_ROOT` | Parent of project | Default folder on startup |

Use a `.env` file or edit `start.bat`.

---

## 📂 Project layout

```
├── start.bat
├── package.json
├── vite.config.ts
├── src/
│   ├── App.tsx
│   ├── api.ts
│   ├── main.tsx
│   └── index.css
└── server/
    ├── index.cjs
    ├── search.cjs
    └── searchParser.cjs
```

---

## 🔌 API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health + default root |
| `GET` | `/api/listing?path=` | List folders & files |
| `POST` | `/api/search` | SSE: `result`, `progress`, `done` |
| `POST` | `/api/stop` | Abort search |
| `POST` | `/api/save` | Write results to a path |
| `POST` | `/api/pick-folder` | Native folder picker |
| `POST` | `/api/pick-save-path` | Native Save As dialog |

---

## 📈 Performance & production (150GB+)

- **Streaming**: Files are never fully loaded; the server uses `readline` and configurable stream buffers so memory stays bounded even over 150GB.
- **Auto-tune from OS**: On startup the server reads **CPU count** and **RAM** (`os.cpus().length`, `os.totalmem()`, `os.freemem()`) and sets:
  - **Concurrency**: number of files searched in parallel (default from CPU count, 4–24). More cores ⇒ more parallel files.
  - **Stream buffer**: read buffer size (default from RAM: 8–32 MB). e.g. 16 GB+ total and 4 GB+ free ⇒ 32 MB buffer; 8 GB+ total and 2 GB+ free ⇒ 16 MB.
  You can still override with env (see below).
- **Concurrency**: 
  - If `SEARCH_CONCURRENCY` is set (1–32), that value is used.
  - Else the client can send `concurrencyHint` (e.g. `navigator.hardwareConcurrency`); server uses hint×2 (capped 4–24).
  - Else server uses **CPU count** (4–24) from `os.cpus().length`.
- **Stream buffer**: `SEARCH_STREAM_HWM_MB=16` (range 2–64) overrides the RAM-based default. When not set, buffer size is chosen from total/free memory as above.
- **Result cap**: Search stops after `maxResults` (client default 100k, max 500k). Export to Excel is capped at 150k rows for reliability; the UI shows when results are capped.
- **Stress test**: Run the built-in stress test to verify your setup:
  - **Quick** (~50MB, 5 files): `npm run test:stress` or `node stress-test.cjs --quick`
  - **Full** (200MB, 20 files): `npm run test:stress:full` or `node stress-test.cjs`
  - **Custom**: `node stress-test.cjs --size=500 --files=30` for 500MB across 30 files.
  - Covers: empty query, keyword, AND, OR, exclude, wildcard, regex, 50k/100k result sets, and abort.

---

## 🛠️ Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Tailwind v4, Vite 6 |
| UI | Motion (Framer Motion), Lucide icons |
| Backend | Node.js, Express 4 |
| Search | Custom streaming + parallel pool |
| Pickers | PowerShell (FolderBrowserDialog / SaveFileDialog) on Windows |

---

## 📄 License

MIT — use it for anything you like.

const API_BASE = '';

export async function getDefaultRoot(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error('Local server not running');
  const data = await res.json();
  return data.root ?? '';
}

export async function pickFolder(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/pick-folder`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.path ?? null;
}

export async function pickSavePath(defaultName = 'search_results.txt'): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/pick-save-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.path ?? null;
}

export async function getListing(dirPath?: string): Promise<{ path: string; folders: { name: string; path: string }[]; files: { name: string; path: string; size: number }[] }> {
  const params = new URLSearchParams();
  if (dirPath && dirPath.trim() !== '') params.set('path', dirPath.trim());
  const qs = params.toString();
  const url = qs ? `${API_BASE}/api/listing?${qs}` : `${API_BASE}/api/listing`;
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

export async function runSearch(params: {
  query: string;
  exclude: string;
  maxResults: number;
  options: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; fastMode?: boolean };
  basePath: string;
  filePaths: string[];
  concurrencyHint?: number;
}, callbacks: {
  onResult: (r: { line: number | null; content: string; file: string }) => void;
  onProgress: (data: { pct: number; file?: string | null; filePct?: number; filesDone?: number; totalFiles?: number }) => void;
  onDone: (data: { total?: number; timeMs?: number; error?: string }) => void;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: params.query,
      exclude: params.exclude,
      maxResults: params.maxResults,
      options: {
        caseSensitive: params.options.caseSensitive,
        wholeWord: params.options.wholeWord,
        regex: params.options.regex,
      },
      basePath: params.basePath,
      filePaths: params.filePaths.length ? params.filePaths : undefined,
      concurrencyHint: params.concurrencyHint,
    }),
  });
  if (!res.ok) {
    callbacks.onDone({ error: res.statusText });
    return;
  }
  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onDone({ error: 'No body' });
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      let event = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (event === 'result') callbacks.onResult(data);
            else if (event === 'progress') callbacks.onProgress({
              pct: data.pct ?? 0,
              file: data.file ?? null,
              filePct: data.filePct ?? 0,
              filesDone: data.filesDone ?? 0,
              totalFiles: data.totalFiles ?? 0,
            });
            else if (event === 'done') callbacks.onDone(data);
          } catch (_) {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function stopSearch(): Promise<void> {
  await fetch(`${API_BASE}/api/stop`, { method: 'POST' });
}

export async function saveResults(
  filePath: string,
  results: { line: number | null; content: string; file: string }[],
  options?: { contentOnly?: boolean }
): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(`${API_BASE}/api/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, results, contentOnly: options?.contentOnly ?? false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

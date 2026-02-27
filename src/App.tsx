import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FolderOpen, FileText, Search, X, Copy, Trash2, ArrowDownAZ, Replace,
  CopyCheck, Files, Ban, Settings2, Play, Square, Zap, Regex, CaseSensitive,
  WholeWord, Eye, List, AlignJustify, FileCode, Hash, CheckCircle2, AlertCircle,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUp, HardDrive, Download
} from 'lucide-react';
import { motion } from 'motion/react';
import * as api from './api';

interface SearchResult {
  id: string;
  line: number | null;
  content: string;
  file: string;
  selected: boolean;
}

interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean; fastMode: boolean; live: boolean; }
interface DisplayOptions { showNumber: boolean; showLine: boolean; showFile: boolean; contentOnly: boolean; }
interface DirEntry { name: string; path: string; }
interface FileEntry { name: string; path: string; size: number; }

const RESULTS_PER_PAGE = 200;
const OPERATOR_SUGGESTIONS = ['AND', 'OR', 'NOT', 'LIKE', 'AND NOT'];

const IconButton = ({ icon: Icon, label, onClick, variant = 'secondary', className = '', disabled = false }: {
  icon: any; label: string; onClick?: () => void; variant?: 'primary'|'secondary'|'danger'|'success'|'warning'|'info'; className?: string; disabled?: boolean;
}) => {
  const v: Record<string, string> = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700',
    danger: 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20',
    warning: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/20',
    info: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/20',
  };
  return (
    <motion.button whileTap={{ scale: 0.98 }} onClick={onClick} disabled={disabled}
      className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-sm ${v[variant]} ${disabled ? 'opacity-50 cursor-not-allowed grayscale' : 'cursor-pointer'} ${className}`}>
      <Icon size={18} strokeWidth={2.5} /><span className="truncate">{label}</span>
    </motion.button>
  );
};

const ToggleChip = ({ active, label, icon: Icon, onClick }: { active: boolean; label: string; icon?: any; onClick: () => void }) => (
  <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${active ? 'bg-blue-500/20 border-blue-500/50 text-blue-200' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-300'}`}>
    {Icon && <Icon size={14} />}{label}
  </button>
);

function formatSize(bytes: number) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function pathParts(p: string): { label: string; path: string }[] {
  const sep = p.includes('/') && !p.includes('\\') ? '/' : '\\';
  const parts = p.split(/[/\\]/).filter(Boolean);
  const result: { label: string; path: string }[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? acc + sep + part : (sep === '\\' ? part : '/' + part);
    if (sep === '\\' && result.length === 0 && !acc.endsWith('\\')) acc += '\\';
    result.push({ label: part, path: acc });
  }
  return result;
}

export default function App() {
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState<DirEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navFuture, setNavFuture] = useState<string[]>([]);
  const [defaultRoot, setDefaultRoot] = useState('');
  const [mapDirInput, setMapDirInput] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFilesModal, setShowFilesModal] = useState(false);

  const [query, setQuery] = useState('');
  const [exclude, setExclude] = useState('');
  const [maxResults, setMaxResults] = useState(100000);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const [searchTimeMs, setSearchTimeMs] = useState(0);
  const [options, setOptions] = useState<SearchOptions>({ regex: false, caseSensitive: false, wholeWord: false, fastMode: true, live: false });
  const [display, setDisplay] = useState<DisplayOptions>({ showNumber: false, showLine: false, showFile: false, contentOnly: true });

  const resultsRef = useRef<SearchResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [resultsVersion, setResultsVersion] = useState(0); // bump after sort/dedup/reverse so list re-renders
  const [sortOrder, setSortOrder] = useState<'az' | 'za'>('az'); // toggles each click
  const [scanningFile, setScanningFile] = useState<string | null>(null); // current file being scanned
  const lastCountUpdateRef = useRef(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(resultCount / RESULTS_PER_PAGE));
  const pageResults = useMemo(() => resultsRef.current.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE), [page, resultCount, resultsVersion]);

  const [showHelp, setShowHelp] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceFind, setReplaceFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!saveFeedback) return;
    const t = setTimeout(() => setSaveFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [saveFeedback]);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sugIdx, setSugIdx] = useState(0);
  const queryRef = useRef<HTMLInputElement>(null);

  const navigateTo = useCallback((dirPath: string, pushHistory = true) => {
    setLoadError(null);
    api.getListing(dirPath).then(data => {
      if (pushHistory && currentPath && currentPath !== data.path) {
        setNavHistory(h => [...h, currentPath]);
        setNavFuture([]);
      }
      setCurrentPath(data.path);
      setFolders(data.folders);
      setFiles(data.files);
      setMapDirInput(data.path);
    }).catch(err => {
      setLoadError(err.message || 'Failed to load directory');
    });
  }, [currentPath]);

  const goBack = () => {
    if (navHistory.length === 0) return;
    const prev = navHistory[navHistory.length - 1];
    setNavHistory(h => h.slice(0, -1));
    setNavFuture(f => [currentPath, ...f]);
    navigateTo(prev, false);
  };

  const goForward = () => {
    if (navFuture.length === 0) return;
    const next = navFuture[0];
    setNavFuture(f => f.slice(1));
    setNavHistory(h => [...h, currentPath]);
    navigateTo(next, false);
  };

  const goUp = () => {
    const parent = currentPath.replace(/[/\\][^/\\]+[/\\]?$/, '');
    if (parent && parent !== currentPath) navigateTo(parent);
  };

  useEffect(() => {
    api.getDefaultRoot().then(root => {
      setDefaultRoot(root);
      setMapDirInput(root);
      return api.getListing();
    }).then(data => {
      setCurrentPath(data.path);
      setFolders(data.folders);
      setFiles(data.files);
      setMapDirInput(data.path);
      setLoadError(null);
    }).catch(() => {
      setCurrentPath('');
      setLoadError('Local server not running. Run start.bat or "npm run dev:all", then click Retry.');
    });
  }, []);

  const [isBrowsing, setIsBrowsing] = useState(false);
  const handleBrowseFolder = async () => {
    setIsBrowsing(true);
    setLoadError(null);
    try {
      const picked = await api.pickFolder();
      if (picked) navigateTo(picked);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Folder picker failed');
    } finally {
      setIsBrowsing(false);
    }
  };

  const updateSuggestions = (val: string) => {
    setQuery(val);
    const cursor = queryRef.current?.selectionStart ?? val.length;
    const left = val.slice(0, cursor);
    const tokenStart = Math.max(left.lastIndexOf(' '), left.lastIndexOf(',')) + 1;
    const token = left.slice(tokenStart).toUpperCase();
    if (token.length >= 1) {
      const matches = OPERATOR_SUGGESTIONS.filter(s => s.startsWith(token) && s !== token);
      setSuggestions(matches);
      setSugIdx(0);
    } else {
      setSuggestions([]);
    }
  };

  const acceptSuggestion = (sug: string) => {
    const val = query;
    const cursor = queryRef.current?.selectionStart ?? val.length;
    const left = val.slice(0, cursor);
    const tokenStart = Math.max(left.lastIndexOf(' '), left.lastIndexOf(',')) + 1;
    const newVal = val.slice(0, tokenStart) + sug + ' ' + val.slice(cursor);
    setQuery(newVal);
    setSuggestions([]);
    setTimeout(() => {
      const pos = tokenStart + sug.length + 1;
      queryRef.current?.setSelectionRange(pos, pos);
      queryRef.current?.focus();
    }, 0);
  };

  const handleQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.length > 0)) {
        e.preventDefault();
        acceptSuggestion(suggestions[sugIdx]);
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSugIdx(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSugIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape') { setSuggestions([]); return; }
    }
    if (e.key === 'Enter') { handleSearch(); }
  };

  const handleSearch = () => {
    if (!query.trim()) return;
    setSuggestions([]);
    setIsSearching(true);
    setStatus('Searching...');
    setProgress(0);
    resultsRef.current = [];
    setResultCount(0);
    setPage(1);
    setSearchTimeMs(0);

    const selectedPathsHere = files.filter(f => selectedFiles.has(f.path)).map(f => f.path);
    const filesToSearch = selectedPathsHere.length > 0
      ? selectedPathsHere
      : files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => f.path);

    let count = 0;
    lastCountUpdateRef.current = Date.now();
    api.runSearch(
      { query: query.trim(), exclude, maxResults: Math.min(maxResults, 500000),
        options: { caseSensitive: options.caseSensitive, wholeWord: options.wholeWord, regex: options.regex },
        basePath: currentPath, filePaths: filesToSearch },
      {
        onResult: (r) => {
          count++;
          resultsRef.current.push({ id: String(count), line: r.line, content: r.content, file: r.file, selected: false });
          const now = Date.now();
          if (now - lastCountUpdateRef.current >= 200 || count <= 10) {
            lastCountUpdateRef.current = now;
            setResultCount(count);
          }
        },
        onProgress: (pct, file) => {
          setProgress(pct);
          if (file) setScanningFile(file);
        },
        onDone: data => {
          setIsSearching(false);
          setProgress(100);
          setScanningFile(null);
          setResultCount(resultsRef.current.length);
          setStatus(data.error ? data.error : 'Ready');
          if (data.timeMs != null) setSearchTimeMs(data.timeMs);
        },
      }
    );
  };

  const handleStop = () => { api.stopSearch().then(() => { setIsSearching(false); setStatus('Stopped'); setResultCount(resultsRef.current.length); }); };

  const handleClear = () => { resultsRef.current = []; setResultCount(0); setPage(1); setStatus('Idle'); setProgress(0); setSearchTimeMs(0); };

  const toggleResultSelected = (id: string) => {
    const r = resultsRef.current.find(x => x.id === id);
    if (r) r.selected = !r.selected;
    setResultCount(c => c);  // force re-render
  };

  const handleDownloadResults = () => {
    if (resultsRef.current.length === 0) {
      setStatus('No results to save');
      setSaveFeedback({ type: 'error', message: 'No results to save.' });
      return;
    }
    const total = resultsRef.current.length;
    const text = display.contentOnly
      ? resultsRef.current.map(r => r.content).join('\n')
      : resultsRef.current.map(r => `${r.file}\t${r.line}\t${r.content}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'search_results.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const msg = `Download ready: search_results.txt (${total} results). Choose where to save in the browser dialog.`;
    setStatus(msg);
    setSaveFeedback({ type: 'success', message: `Saved ${total} results. Use the browser's dialog to choose where to save search_results.txt.` });
  };

  const handleCopySelected = async () => {
    const sel = resultsRef.current.filter(r => r.selected);
    const src = sel.length ? sel : pageResults;
    const text = display.contentOnly
      ? src.map(r => r.content).join('\n')
      : src.map(r => `${r.file}\t${r.line}\t${r.content}`).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${src.length} rows`);
  };

  const handleCopyAll = async () => {
    const text = display.contentOnly
      ? resultsRef.current.map(r => r.content).join('\n')
      : resultsRef.current.map(r => `${r.file}\t${r.line}\t${r.content}`).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${resultsRef.current.length} rows`);
  };

  const handleSort = () => {
    const dir = sortOrder === 'az' ? 1 : -1;
    resultsRef.current.sort((a, b) => {
      const f = a.file.localeCompare(b.file) * dir;
      return f !== 0 ? f : ((a.line ?? 0) - (b.line ?? 0)) * dir;
    });
    setSortOrder(s => s === 'az' ? 'za' : 'az');
    setResultCount(c => c);
    setResultsVersion(v => v + 1);
    setStatus(sortOrder === 'az' ? 'Sorted A-Z' : 'Sorted Z-A');
  };

  const handleDeduplicate = () => {
    const before = resultsRef.current.length;
    const seen = new Set<string>();
    resultsRef.current = resultsRef.current.filter(r => { const k = `${r.file}\t${r.line}\t${r.content}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const after = resultsRef.current.length;
    const removed = before - after;
    setResultCount(after);
    setResultsVersion(v => v + 1);
    const msg = removed === 0 ? 'No duplicates found' : `Removed ${removed} duplicate${removed === 1 ? '' : 's'} (${after} remaining)`;
    setStatus(msg);
    setSaveFeedback(removed > 0 ? { type: 'success', message: msg } : null);
  };

  const handleReplace = () => {
    if (!replaceFind.trim()) return;
    for (const r of resultsRef.current) r.content = r.content.split(replaceFind).join(replaceWith);
    setShowReplaceModal(false); setReplaceFind(''); setReplaceWith(''); setResultCount(c => c); setStatus('Replaced');
  };

  const getFileName = (fp: string) => fp.replace(/^.*[/\\]/, '');

  const selectedInCurrent = useMemo(() => files.filter(f => selectedFiles.has(f.path)), [files, selectedFiles]);
  const selectedCount = selectedInCurrent.length;
  const totalSizeBytes = selectedCount > 0
    ? selectedInCurrent.reduce((s, f) => s + f.size, 0)
    : files.reduce((s, f) => s + f.size, 0);
  const badgeText = selectedCount > 0 ? `${selectedCount}/${files.length} selected | ${formatSize(totalSizeBytes)}` : `${files.length} files | ${formatSize(totalSizeBytes)}`;
  const breadcrumbs = currentPath ? pathParts(currentPath) : [];

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden selection:bg-blue-500/30">

      <div className="flex items-center gap-1.5 p-2 bg-slate-900 border-b border-slate-800 shadow-sm z-10">
        <button onClick={goBack} disabled={navHistory.length === 0} className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0" title="Back"><ChevronLeft size={16} /></button>
        <button onClick={goForward} disabled={navFuture.length === 0} className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0" title="Forward"><ChevronRight size={16} /></button>
        <button onClick={goUp} className="p-1.5 rounded hover:bg-slate-800 shrink-0" title="Up one level"><ArrowUp size={16} /></button>

        <input type="text" value={mapDirInput} onChange={e => setMapDirInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigateTo(mapDirInput.trim())}
          placeholder="Type or paste path, press Enter"
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-blue-500/40 outline-none" />

        <button onClick={handleBrowseFolder} disabled={isBrowsing}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 ${isBrowsing ? 'bg-blue-600 text-white animate-pulse cursor-wait' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'}`}
          title="Open folder picker dialog">
          <FolderOpen size={14} /> {isBrowsing ? 'Opening…' : 'Browse'}
        </button>

        <button onClick={() => setShowFilesModal(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0">
          <FileText size={14} /> Files
        </button>

        <div className="px-2.5 py-1 bg-slate-800 rounded-md text-[11px] font-mono text-slate-400 border border-slate-700 shrink-0">{badgeText}</div>

        {loadError && <button onClick={() => navigateTo(defaultRoot || '')} className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold shrink-0">Retry</button>}
      </div>

      <div className="flex-none flex flex-col gap-2.5 p-3 overflow-y-auto max-h-[38vh]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-100"><Search size={16} className="text-blue-400" /> Search Query</label>
            <div className="text-[10px] text-slate-500 font-mono tracking-wide">AND · OR · NOT · LIKE · * | Tab = autocomplete | Enter = search</div>
          </div>
          <div className="relative">
            <input ref={queryRef} type="text" value={query} onChange={e => updateSuggestions(e.target.value)} onKeyDown={handleQueryKeyDown}
              onBlur={() => setTimeout(() => setSuggestions([]), 150)}
              placeholder="Type to search… (e.g. password AND email, foo OR bar, NOT spam)"
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none font-mono" />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300" title="Help" onClick={() => setShowHelp(true)}><AlertCircle size={16} /></button>
            {suggestions.length > 0 && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden min-w-[160px]">
                {suggestions.map((s, i) => (
                  <button key={s} onMouseDown={e => { e.preventDefault(); acceptSuggestion(s); }}
                    className={`w-full text-left px-3 py-1.5 text-sm font-mono ${i === sugIdx ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{s}</button>
                ))}
                <div className="px-3 py-1 text-[10px] text-slate-500 border-t border-slate-700">Tab to accept</div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider"><Ban size={12} className="text-red-400" /> Exclude (comma-separated keywords to skip)</label>
            <input type="text" value={exclude} onChange={e => setExclude(e.target.value)} placeholder="spam, test, junk"
              className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500/30 focus:border-red-500 outline-none font-mono" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Max Results</label>
            <input type="number" value={maxResults} onChange={e => setMaxResults(Math.max(1, parseInt(e.target.value) || 100000))}
              className="w-32 bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500/30 outline-none font-mono" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleChip label="Regex" icon={Regex} active={options.regex} onClick={() => setOptions(p => ({...p, regex: !p.regex}))} />
            <ToggleChip label="Case" icon={CaseSensitive} active={options.caseSensitive} onClick={() => setOptions(p => ({...p, caseSensitive: !p.caseSensitive}))} />
            <ToggleChip label="Word" icon={WholeWord} active={options.wholeWord} onClick={() => setOptions(p => ({...p, wholeWord: !p.wholeWord}))} />
            <div className="w-px h-4 bg-slate-700 mx-1" />
            <ToggleChip label="Fast" icon={Zap} active={options.fastMode} onClick={() => setOptions(p => ({...p, fastMode: !p.fastMode}))} />
            <ToggleChip label="LIVE" icon={Eye} active={options.live} onClick={() => setOptions(p => ({...p, live: !p.live}))} />
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-400 bg-slate-900/50 p-1.5 rounded-lg border border-slate-800">
            <span className="font-semibold px-1 text-slate-500 uppercase tracking-wider text-[10px]">Display:</span>
            {[['showNumber', Hash, '#'], ['showLine', List, 'Line'], ['showFile', FileCode, 'File']] .map(([key, Icon, lbl]) => (
              <label key={key as string} className="flex items-center gap-1 cursor-pointer hover:text-slate-200">
                <input type="checkbox" checked={(display as any)[key]} onChange={e => setDisplay(p => ({...p, [key as string]: e.target.checked}))} className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0" />
                {React.createElement(Icon as any, { size: 12 })} {lbl as string}
              </label>
            ))}
            <div className="w-px h-3 bg-slate-700" />
            <label className="flex items-center gap-1 cursor-pointer hover:text-slate-200">
              <input type="checkbox" checked={display.contentOnly} onChange={e => setDisplay(p => ({...p, contentOnly: e.target.checked}))} className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0" />
              <AlignJustify size={12} /> Content Only
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          <IconButton icon={Search} label="Search" variant="primary" onClick={handleSearch} disabled={isSearching} />
          <IconButton icon={Square} label="Stop" variant="danger" onClick={handleStop} disabled={!isSearching} />
          <IconButton icon={Download} label="Quick Save" variant="success" className="bg-emerald-700 hover:bg-emerald-600" onClick={handleDownloadResults} title="Save results (browser will ask where to save)" />
          <IconButton icon={Copy} label="Copy Sel" variant="info" onClick={handleCopySelected} />
          <IconButton icon={CopyCheck} label="Copy All" variant="info" className="bg-cyan-700 hover:bg-cyan-600" onClick={handleCopyAll} />
          <IconButton icon={X} label="Clear" variant="warning" onClick={handleClear} />
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2"><Settings2 size={14} /> Tools:</div>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors" onClick={handleSort} title={sortOrder === 'az' ? 'Sort A-Z (next click: Z-A)' : 'Sort Z-A (next click: A-Z)'}><ArrowDownAZ size={14} /> Sort {sortOrder === 'az' ? 'A→Z' : 'Z→A'}</button>
            <button className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors" onClick={() => setShowReplaceModal(true)}><Replace size={14} /> Replace</button>
            <button className="px-3 py-1.5 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors" onClick={handleDeduplicate}><Trash2 size={14} /> Deduplicate</button>
          </div>
        </div>
      </div>

      {saveFeedback && (
        <div className={`mx-4 mb-2 px-4 py-3 rounded-lg border flex items-center justify-between gap-3 shadow-lg ${saveFeedback.type === 'success' ? 'bg-emerald-950/90 border-emerald-600/50 text-emerald-200' : 'bg-red-950/90 border-red-600/50 text-red-200'}`}>
          <span className="flex items-center gap-2 text-sm font-medium">
            {saveFeedback.type === 'success' ? <CheckCircle2 size={20} className="text-emerald-400 shrink-0" /> : <AlertCircle size={20} className="text-red-400 shrink-0" />}
            {saveFeedback.message}
          </span>
          <button type="button" onClick={() => setSaveFeedback(null)} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200" aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="px-4 pb-1.5">
        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
          <motion.div className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ type: 'tween', ease: 'linear' }} />
        </div>
        <div className="flex justify-between items-center mt-0.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
            {isSearching ? <Play size={10} className="text-blue-400 animate-pulse" /> : <CheckCircle2 size={10} className="text-emerald-500" />}{status}
          </span>
          <span className="text-[10px] font-mono text-slate-600">{progress}%</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-slate-900 mx-4 mb-0 border-x border-t border-slate-800 rounded-t-lg overflow-hidden flex flex-col">
        <div className="flex items-center bg-slate-950 border-b border-slate-800 px-4 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider select-none">
          {display.showNumber && <div className="w-12 shrink-0">#</div>}
          {display.showLine && <div className="w-16 shrink-0 text-right pr-4">Line</div>}
          <div className="flex-1">Content</div>
          {display.showFile && <div className="w-64 shrink-0 text-right">File</div>}
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {resultCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
              <Search size={48} strokeWidth={1} className="opacity-20" />
              <p className="text-sm font-medium">No results. Enter a query and press Search.</p>
            </div>
          ) : (
            pageResults.map((res, idx) => (
              <div key={res.id} onClick={() => toggleResultSelected(res.id)}
                className={`flex items-center px-4 py-1 hover:bg-slate-800/50 border-b border-slate-800/50 text-sm font-mono cursor-pointer group transition-colors ${res.selected ? 'bg-blue-900/20 border-l-2 border-l-blue-500' : ''}`}>
                {display.showNumber && <div className="w-12 shrink-0 text-slate-600 text-xs">{(page - 1) * RESULTS_PER_PAGE + idx + 1}</div>}
                {display.showLine && <div className="w-16 shrink-0 text-right pr-4 text-emerald-600/80 group-hover:text-emerald-500">{res.line ?? '—'}</div>}
                <div className="flex-1 truncate text-slate-300 group-hover:text-slate-100" title={res.content}>{res.content}</div>
                {display.showFile && <div className="w-64 shrink-0 text-right text-slate-500 text-xs truncate pl-4 group-hover:text-slate-400" title={res.file}>{getFileName(res.file)}</div>}
              </div>
            ))
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-1.5 border-t border-slate-800 bg-slate-950 text-xs">
            <button onClick={() => setPage(1)} disabled={page === 1} className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"><ChevronsLeft size={14} /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span className="text-slate-400 font-mono px-2">Page <span className="text-slate-200 font-bold">{page}</span> of <span className="text-slate-200 font-bold">{totalPages}</span></span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"><ChevronRight size={14} /></button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"><ChevronsRight size={14} /></button>
            <span className="text-slate-500 ml-2">({RESULTS_PER_PAGE}/page)</span>
          </div>
        )}
      </div>

      <div className="bg-slate-950 border-t border-slate-800 p-1.5 px-4 flex justify-between items-center text-xs font-mono text-slate-500 select-none">
        <div className="flex items-center gap-4">
          <span className="text-slate-400">Total: <span className="text-slate-200 font-bold">{resultCount.toLocaleString()}</span></span>
          <span>|</span>
          <span>Time: {(searchTimeMs / 1000).toFixed(2)}s</span>
          {totalPages > 1 && <><span>|</span><span>Page {page}/{totalPages}</span></>}
          {isSearching && scanningFile && <><span>|</span><span className="text-blue-400/80 truncate max-w-[280px]" title={scanningFile}>Scanning: {scanningFile}</span></>}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isSearching ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="uppercase tracking-wider">{isSearching ? 'Processing' : 'Idle'}</span>
        </div>
      </div>

      {showHelp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowHelp(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-w-lg w-full p-6 text-sm text-slate-200 font-mono" onClick={e => e.stopPropagation()}>
            <h3 className="text-slate-100 font-bold uppercase tracking-wider mb-3">Query Syntax Guide</h3>
            <ul className="space-y-2 mb-4">
              <li><span className="text-blue-400 font-bold">AND</span> — all terms must match: <code className="text-slate-400">foo AND bar</code></li>
              <li><span className="text-blue-400 font-bold">OR</span> — any term matches: <code className="text-slate-400">foo OR bar</code></li>
              <li><span className="text-red-400 font-bold">NOT</span> — exclude term: <code className="text-slate-400">foo AND NOT spam</code></li>
              <li><span className="text-cyan-400 font-bold">LIKE</span> — both parts must appear: <code className="text-slate-400">email LIKE @gmail</code></li>
              <li><span className="text-amber-400 font-bold">Comma</span> = OR: <code className="text-slate-400">a, b, c</code></li>
              <li><span className="text-amber-400 font-bold">*</span> wildcard: <code className="text-slate-400">pass*word</code> matches anything between</li>
              <li><strong>Regex</strong> toggle: full regex in keywords</li>
              <li><strong>Exclude</strong> field: comma-separated keywords to skip matching lines</li>
            </ul>
            <p className="text-slate-500 text-xs mb-1">Autocomplete: start typing an operator and press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-300">Tab</kbd> to accept.</p>
            <p className="text-slate-500 text-xs">All processing is local on your PC. Results are paginated ({RESULTS_PER_PAGE}/page) for stability.</p>
            <button className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm" onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}

      {showFilesModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowFilesModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 font-bold text-slate-200 uppercase tracking-wider text-xs">Select files to search in {getFileName(currentPath)}</div>
            <div className="p-2 overflow-y-auto flex-1">
              {files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => (
                <label key={f.path} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer text-sm font-mono text-slate-300">
                  <input type="checkbox" checked={selectedFiles.has(f.path)} onChange={() => setSelectedFiles(prev => { const n = new Set(prev); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })} className="rounded border-slate-600 bg-slate-800 text-blue-500" />
                  {f.name} <span className="text-slate-500 text-xs">({formatSize(f.size)})</span>
                </label>
              ))}
              {files.filter(f => f.name.toLowerCase().endsWith('.txt')).length === 0 && <p className="text-slate-500 text-sm p-2">No .txt files in this folder</p>}
            </div>
            <div className="flex gap-2 p-3 border-t border-slate-800">
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold" onClick={() => { setSelectedFiles(new Set(files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => f.path))); }}>Select All</button>
              <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm" onClick={() => { setSelectedFiles(new Set()); }}>Clear All</button>
              <div className="flex-1" />
              <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold" onClick={() => setShowFilesModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showReplaceModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowReplaceModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-slate-100 font-bold uppercase tracking-wider text-xs mb-4">Replace in results</h3>
            <input type="text" value={replaceFind} onChange={e => setReplaceFind(e.target.value)} placeholder="Find" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 mb-2 font-mono text-sm" />
            <input type="text" value={replaceWith} onChange={e => setReplaceWith(e.target.value)} placeholder="Replace with" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 mb-4 font-mono text-sm" />
            <div className="flex gap-2">
              <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm" onClick={() => setShowReplaceModal(false)}>Cancel</button>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold" onClick={handleReplace}>Replace All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

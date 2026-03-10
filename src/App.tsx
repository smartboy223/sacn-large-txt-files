import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FolderOpen, FileText, Search, X, Copy, Trash2, ArrowDownAZ, Replace,
  CopyCheck, Files, Ban, Settings2, Play, Square, Regex, CaseSensitive,
  WholeWord, List, AlignJustify, FileCode, Hash, CheckCircle2, AlertCircle,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUp, Download,
  ClipboardPaste, LayoutGrid
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import * as api from './api';

interface SearchResult {
  id: string;
  line: number | null;
  content: string;
  file: string;
  selected: boolean;
}

interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean; }
interface DisplayOptions { showNumber: boolean; showLine: boolean; showFile: boolean; contentOnly: boolean; }
interface DirEntry { name: string; path: string; }
interface FileEntry { name: string; path: string; size: number; }

const RESULTS_PER_PAGE = 200;
const MAX_EXPORT_ROWS = 150000;
const OPERATOR_SUGGESTIONS = ['AND', 'OR', 'NOT', 'LIKE', 'AND NOT'];
const STORAGE_KEY_SELECTED_FILES = 'advanced-search-selected-files';

function loadSelectedFilesForPath(path: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_FILES);
    if (!raw) return new Set();
    const obj = JSON.parse(raw) as Record<string, string[]>;
    const arr = obj[path];
    return arr ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveSelectedFilesForPath(path: string, paths: Set<string>) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_FILES);
    const obj = (raw ? JSON.parse(raw) : {}) as Record<string, string[]>;
    obj[path] = Array.from(paths);
    localStorage.setItem(STORAGE_KEY_SELECTED_FILES, JSON.stringify(obj));
  } catch {}
}

const splitToValues = (text: string): string[] =>
  text.split(/[,\t;\n\r]+/).map(s => s.trim()).filter(Boolean);

const QUERY_OPERATOR_COLORS: Record<string, string> = {
  AND: 'text-blue-400 font-semibold',
  OR: 'text-emerald-400 font-semibold',
  NOT: 'text-red-400 font-semibold',
  LIKE: 'text-cyan-400 font-semibold',
  '(': 'text-slate-500',
  ')': 'text-slate-500',
  ',': 'text-emerald-500/90',
  '*': 'text-amber-400',
};

function highlightQuery(query: string): { type: string; text: string }[] {
  if (!query.trim()) return [];
  const parts: { type: string; text: string }[] = [];
  const re = /\b(AND|OR|NOT|LIKE)\b|([(),])|(\*)/gi;
  let lastEnd = 0;
  let m;
  while ((m = re.exec(query)) !== null) {
    if (m.index > lastEnd) {
      parts.push({ type: 'text', text: query.slice(lastEnd, m.index) });
    }
    const token = m[1] || m[2] || m[3] || '';
    const key = token.toUpperCase() === token && token.length > 1 ? token : token;
    parts.push({ type: key, text: m[0] });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < query.length) parts.push({ type: 'text', text: query.slice(lastEnd) });
  return parts;
}

const QueryPreview = ({ query, className = '' }: { query: string; className?: string }) => {
  const parts = highlightQuery(query);
  if (parts.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-0.5 font-mono text-sm ${className}`}>
      {parts.map((p, i) => (
        <span key={i} className={p.type === 'text' ? 'text-slate-300' : QUERY_OPERATOR_COLORS[p.type] || 'text-slate-300'}>
          {p.text}
        </span>
      ))}
    </div>
  );
};

const SearchChipInput = ({ chips, setChips, inputValue, setInputValue, onInputChange, onKeyDown, onBlur, inputRef, placeholder, suggestions, sugIdx, acceptSuggestion, selectedIndices, onSelectionChange, onCopySelected, onDeleteSelected, className = '' }: {
  chips: string[];
  setChips: (v: string[] | ((prev: string[]) => string[])) => void;
  inputValue: string;
  setInputValue: (v: string) => void;
  onInputChange?: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onBlur?: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  suggestions: string[];
  sugIdx: number;
  acceptSuggestion: (s: string) => void;
  selectedIndices?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
  onCopySelected?: (indices: Set<number>) => void;
  onDeleteSelected?: (indices: Set<number>) => void;
  className?: string;
}) => {
  const addChip = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !chips.includes(trimmed)) setChips(prev => [...prev, trimmed]);
  };
  const removeChip = (i: number) => setChips(prev => prev.filter((_, j) => j !== i));
  const selected = selectedIndices ?? new Set<number>();
  const lastClickedRef = React.useRef<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleChipClick = (e: React.MouseEvent, i: number) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (window.getSelection()?.toString()) return;
    const newSet = new Set(selected);
    if (e.shiftKey && lastClickedRef.current != null) {
      const lo = Math.min(lastClickedRef.current, i);
      const hi = Math.max(lastClickedRef.current, i);
      for (let j = lo; j <= hi; j++) newSet.add(j);
    } else {
      if (newSet.has(i)) newSet.delete(i);
      else newSet.add(i);
    }
    lastClickedRef.current = i;
    onSelectionChange?.(newSet);
    containerRef.current?.focus();
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (selected.size === 0) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDeleteSelected?.(selected);
      onSelectionChange?.(new Set());
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'x')) {
      e.preventDefault();
      onCopySelected?.(selected);
      if (e.key === 'x') {
        onDeleteSelected?.(selected);
        onSelectionChange?.(new Set());
      }
    } else if (e.key === 'Escape') {
      onSelectionChange?.(new Set());
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text');
    const parts = splitToValues(pasted);
    if (parts.length > 1) {
      e.preventDefault();
      parts.forEach(p => addChip(p));
      setInputValue('');
    }
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v.includes(',') || v.includes('\t') || v.includes(';')) {
      const parts = splitToValues(v);
      parts.forEach(p => addChip(p));
      setInputValue('');
      onInputChange?.('');
    } else {
      setInputValue(v);
      onInputChange?.(v);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      onKeyDown(e);
      return;
    }
    if (e.key === ',' || e.key === 'Tab' || e.key === ';') {
      const val = inputValue.trim();
      if (val) {
        e.preventDefault();
        addChip(val);
        setInputValue('');
        onInputChange?.('');
        return;
      }
    }
    if (e.key === 'Backspace' && !inputValue && chips.length > 0) {
      e.preventDefault();
      removeChip(chips.length - 1);
      return;
    }
    onKeyDown(e);
  };

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleContainerKeyDown} onClick={e => { if ((e.target as HTMLElement).closest('input')) return; if (!(e.target as HTMLElement).closest('[data-chip]')) onSelectionChange?.(new Set()); }}
      className={`flex flex-wrap items-center gap-2 min-h-[42px] bg-slate-900 border border-white/10 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-blue-500/60 outline-none select-text shadow-lg shadow-black/10 ${className}`}>
      {chips.map((c, i) => (
        <span key={`${c}-${i}`} data-chip
          onClick={e => handleChipClick(e, i)}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-mono border cursor-pointer select-text backdrop-blur-sm ${selected.has(i) ? 'bg-blue-500/40 border-blue-400/60 ring-1 ring-blue-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
          {highlightQuery(c).map((p, j) => (
            <span key={j} className={p.type === 'text' ? 'text-slate-200' : QUERY_OPERATOR_COLORS[p.type] || 'text-slate-200'}>
              {p.text}
            </span>
          ))}
          <button type="button" onClick={() => removeChip(i)} className="p-0.5 rounded hover:bg-slate-600 text-blue-400 hover:text-white transition-colors select-none" aria-label="Remove">
            <X size={14} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <div className="relative flex-1 min-w-[120px]">
        <input ref={inputRef} type="text" value={inputValue} onChange={handleInputChange} onKeyDown={handleKeyDown} onPaste={handlePaste} onBlur={onBlur}
          placeholder={chips.length === 0 ? placeholder : 'Add more…'}
          className="w-full min-w-0 bg-transparent border-none outline-none text-slate-100 text-sm font-mono placeholder-slate-500 py-0.5" />
        {suggestions.length > 0 && (
          <div className="absolute left-0 top-full mt-1 z-[100] bg-slate-950 border border-slate-600 rounded-lg shadow-2xl overflow-hidden min-w-[180px] ring-1 ring-black/30">
            {suggestions.map((s, i) => (
              <button key={s} onMouseDown={e => { e.preventDefault(); acceptSuggestion(s); }}
                className={`w-full text-left px-3 py-2 text-sm font-mono ${i === sugIdx ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-800'}`}>{s}</button>
            ))}
            <div className="px-3 py-2 text-xs text-slate-400 border-t border-slate-700 bg-slate-900 font-medium">Tab to accept</div>
          </div>
        )}
      </div>
    </div>
  );
};

const ExcludeChipInput = ({ chips, setChips, placeholder, className = '' }: {
  chips: string[];
  setChips: (v: string[] | ((prev: string[]) => string[])) => void;
  placeholder?: string;
  className?: string;
}) => {
  const addChip = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !chips.includes(trimmed)) setChips(prev => [...prev, trimmed]);
  };
  const removeChip = (i: number) => setChips(prev => prev.filter((_, j) => j !== i));
  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text');
    const parts = splitToValues(pasted);
    if (parts.length > 1) {
      e.preventDefault();
      parts.forEach(p => addChip(p));
      setExcludeInput('');
    }
  };
  const [excludeInput, setExcludeInput] = useState('');
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v.includes(',') || v.includes('\t') || v.includes(';')) {
      splitToValues(v).forEach(p => addChip(p));
      setExcludeInput('');
    } else {
      setExcludeInput(v);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ',' || e.key === 'Tab' || e.key === ';') {
      const val = excludeInput.trim();
      if (val) {
        e.preventDefault();
        addChip(val);
        setExcludeInput('');
      }
    }
    if (e.key === 'Backspace' && !excludeInput && chips.length > 0) {
      e.preventDefault();
      removeChip(chips.length - 1);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 min-h-[40px] bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-red-500/30 focus-within:border-red-500/60 outline-none shadow-lg shadow-black/10 ${className}`}>
      {chips.map((c, i) => (
        <span key={`${c}-${i}`} className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/5 backdrop-blur-sm rounded-lg text-xs font-mono text-slate-300 border border-white/10">
          {c}
          <button type="button" onClick={() => removeChip(i)} className="p-0.5 rounded hover:bg-slate-600 text-red-400 hover:text-white transition-colors" aria-label="Remove">
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input type="text" value={excludeInput} onChange={handleInputChange} onKeyDown={handleKeyDown} onPaste={handlePaste}
        placeholder={chips.length === 0 ? placeholder : 'Add more…'}
        className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-slate-300 text-sm font-mono placeholder-slate-500 py-0.5" />
    </div>
  );
};

const IconButton = ({ icon: Icon, label, onClick, variant = 'secondary', className = '', disabled = false }: {
  icon: any; label: string; onClick?: () => void; variant?: 'primary'|'secondary'|'danger'|'success'|'warning'|'info'; className?: string; disabled?: boolean;
}) => {
  const v: Record<string, string> = {
    primary: 'bg-blue-600/90 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30 border border-blue-500/30 backdrop-blur-sm',
    secondary: 'bg-white/10 hover:bg-white/15 active:bg-white/20 text-slate-200 border border-white/10 hover:border-white/20 backdrop-blur-sm',
    danger: 'bg-red-600/90 hover:bg-red-500 text-white shadow-lg shadow-red-900/30 border border-red-500/30 backdrop-blur-sm',
    success: 'bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 border border-emerald-500/30 backdrop-blur-sm',
    warning: 'bg-amber-600/90 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30 border border-amber-500/30 backdrop-blur-sm',
    info: 'bg-cyan-600/90 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/30 border border-cyan-500/30 backdrop-blur-sm',
  };
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      whileHover={disabled ? {} : { scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 ${v[variant]} ${disabled ? 'opacity-50 cursor-not-allowed grayscale' : 'cursor-pointer active:shadow-inner'} ${className}`}
    >
      <Icon size={18} strokeWidth={2.5} /><span className="truncate">{label}</span>
    </motion.button>
  );
};

const ToggleChip = ({ active, label, icon: Icon, onClick, title, disabled }: { active: boolean; label: string; icon?: any; onClick: () => void; title?: string; disabled?: boolean }) => (
  <motion.button
    onClick={onClick}
    title={title}
    disabled={disabled}
    whileTap={disabled ? {} : { scale: 0.92 }}
    whileHover={disabled ? {} : { scale: 1.03 }}
    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border backdrop-blur-sm ${active ? 'bg-blue-500/25 border-blue-500/50 text-blue-200 shadow-sm shadow-blue-500/20' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-300 hover:border-white/20'} ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}`}
  >
    {Icon && <Icon size={14} />}{label}
  </motion.button>
);

function formatSize(bytes: number) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

const EditableCell = ({ value, onChange, className, title }: { value: string; onChange: (v: string) => void; className?: string; title?: string }) => {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input type="text" value={local} onChange={e => setLocal(e.target.value)} onBlur={() => { if (local !== value) onChange(local); }}
      className={`${className ?? ''} overflow-x-auto`} title={title ?? value} />
  );
};

const getActiveColIndices = (rows: string[][]): number[] => {
  const maxCol = rows.length ? Math.max(...rows.map(c => c.length)) : 0;
  const hasData = (col: number) => rows.some(cells => (cells[col] ?? '').trim() !== '');
  return Array.from({ length: maxCol }, (_, i) => i).filter(hasData);
};

const removePrefixesFromText = (text: string, prefixesStr: string): string => {
  if (!prefixesStr.trim()) return text;
  let out = text;
  const prefixes = prefixesStr.split(',').map(s => s.trim()).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of prefixes) {
      if (p && out.toLowerCase().startsWith(p.toLowerCase())) {
        out = out.slice(p.length);
        changed = true;
        break;
      }
    }
  }
  return out;
};

const DEFAULT_COL_WIDTH = 200;
const COL0_DEFAULT = 340;
const COL1_DEFAULT = 280;
const COL2_DEFAULT = 220;
const MIN_COL_WIDTH = 80;
const MAX_COL_WIDTH = 800;

const getDefaultColWidth = (displayIndex: number) => {
  if (displayIndex === 0) return COL0_DEFAULT;
  if (displayIndex === 1) return COL1_DEFAULT;
  if (displayIndex === 2) return COL2_DEFAULT;
  return DEFAULT_COL_WIDTH;
};

const TableViewContent = ({ results, delimiter, removeEssentials, removePrefixesStr, page, totalPages, resultsVersion, onPageChange, onCellEdit, onDeleteRow, onDeleteColumn }: {
  results: SearchResult[];
  delimiter: string;
  removeEssentials: boolean;
  removePrefixesStr: string;
  page: number;
  totalPages: number;
  resultsVersion: number;
  onPageChange: (p: number) => void;
  onCellEdit: (rowIdx: number, colIdx: number, value: string) => void;
  onDeleteRow: (rowIdx: number) => void;
  onDeleteColumn: (colIdx: number) => void;
}) => {
  const { rows, activeColIndices } = useMemo(() => {
    const rows: string[][] = [];
    let maxCol = 0;
    for (const r of results) {
      let text = r.content;
      if (removeEssentials && removePrefixesStr.trim()) text = removePrefixesFromText(text, removePrefixesStr);
      const cells = delimiter ? text.split(delimiter).map(c => c.trim()) : [text];
      rows.push(cells);
      maxCol = Math.max(maxCol, cells.length);
    }
    const hasData = (col: number) => rows.some(cells => (cells[col] ?? '').trim() !== '');
    const activeColIndices = Array.from({ length: maxCol }, (_, i) => i).filter(hasData);
    return { rows, activeColIndices };
  }, [results, delimiter, removeEssentials, removePrefixesStr, resultsVersion]);

  const colCount = activeColIndices.length;
  const [columnWidths, setColumnWidths] = useState<number[]>(() => Array.from({ length: colCount }, (_, i) => getDefaultColWidth(i)));

  useEffect(() => {
    setColumnWidths(prev => {
      const next = [...prev];
      while (next.length < colCount) next.push(getDefaultColWidth(next.length));
      if (next.length > colCount) next.length = colCount;
      return next;
    });
  }, [colCount]);

  const startResize = (col: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = columnWidths[col] ?? DEFAULT_COL_WIDTH;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const newW = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, startW + dx));
      setColumnWidths(prev => {
        const n = [...prev];
        n[col] = newW;
        return n;
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const pageSize = RESULTS_PER_PAGE;
  const pageRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);

  const getColWidth = (i: number) => columnWidths[i] ?? DEFAULT_COL_WIDTH;

  if (colCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        No columns with data — all cells are empty for this delimiter
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-slate-700">
        <div style={{ minWidth: 'max-content' }}>
          <div className="sticky top-0 z-10 flex text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/10 bg-slate-950/80 backdrop-blur-md shrink-0">
            {activeColIndices.map((actualCol, i) => (
              <div key={actualCol} className="flex shrink-0" style={{ width: getColWidth(i) }}>
                <div className="flex-1 flex items-center min-w-0">
                  <span className="truncate px-2 py-1.5">Col {i + 1}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); onDeleteColumn(actualCol); }} className="shrink-0 p-1 rounded hover:bg-red-500/40 text-red-400 hover:text-red-300" title="Delete column"><X size={14} /></button>
                </div>
                <div className="w-2 shrink-0 cursor-col-resize hover:bg-blue-500/40 flex-shrink-0" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startResize(i, e); }} title="Drag to resize column" />
              </div>
            ))}
          </div>
          {pageRows.map((cells, idx) => {
            const rowIdx = (page - 1) * pageSize + idx;
            return (
              <div key={rowIdx} className="flex border-b border-white/5 hover:bg-white/5 group transition-colors">
                {activeColIndices.map((actualCol, i) => (
                  <div key={actualCol} className="shrink-0 px-2 py-1 overflow-hidden" style={{ width: getColWidth(i), minWidth: getColWidth(i) }}>
                    <EditableCell value={cells[actualCol] ?? ''} onChange={v => onCellEdit(rowIdx, actualCol, v)} className="w-full bg-transparent border-none outline-none text-sm font-mono text-slate-300 focus:text-slate-100 px-1 py-0.5 rounded focus:ring-1 focus:ring-blue-500/50 cursor-text" title={cells[actualCol] ?? ''} />
                  </div>
                ))}
                <button type="button" onClick={() => onDeleteRow(rowIdx)} className="opacity-60 hover:opacity-100 shrink-0 p-1 rounded hover:bg-red-500/30 text-red-400 hover:text-red-300" title="Delete row"><X size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-1.5 border-t border-white/10 bg-slate-950/50 backdrop-blur-md text-xs shrink-0">
          <motion.button onClick={() => onPageChange(1)} disabled={page === 1} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronsLeft size={14} /></motion.button>
          <motion.button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronLeft size={14} /></motion.button>
          <span className="text-slate-400 font-mono px-2">Page <span className="text-slate-200 font-bold">{page}</span> of <span className="text-slate-200 font-bold">{totalPages}</span></span>
          <motion.button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronRight size={14} /></motion.button>
          <motion.button onClick={() => onPageChange(totalPages)} disabled={page === totalPages} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronsRight size={14} /></motion.button>
          <span className="text-slate-500 ml-2">({pageSize}/page)</span>
        </div>
      )}
    </div>
  );
};

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

  const [queryChips, setQueryChips] = useState<string[]>([]);
  const [selectedChipIndices, setSelectedChipIndices] = useState<Set<number>>(new Set());
  const [queryInput, setQueryInput] = useState('');
  const [excludeChips, setExcludeChips] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState(100000);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const [searchTimeMs, setSearchTimeMs] = useState(0);
  const [options, setOptions] = useState<SearchOptions>({ regex: false, caseSensitive: false, wholeWord: false });
  const [display, setDisplay] = useState<DisplayOptions>({ showNumber: false, showLine: false, showFile: false, contentOnly: true });

  const resultsRef = useRef<SearchResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [resultsVersion, setResultsVersion] = useState(0); // bump after sort/dedup/reverse so list re-renders
  const [sortOrder, setSortOrder] = useState<'az' | 'za'>('az');
  const [sortBy, setSortBy] = useState<'file' | 'content'>('content'); // toggles each click
  const [scanningFile, setScanningFile] = useState<string | null>(null);
  const [filesDone, setFilesDone] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [fileProgress, setFileProgress] = useState(0);
  const lastCountUpdateRef = useRef(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(resultCount / RESULTS_PER_PAGE));
  const pageResults = useMemo(() => resultsRef.current.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE), [page, resultCount, resultsVersion]);

  const [showHelp, setShowHelp] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceFind, setReplaceFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [resultsViewMode, setResultsViewMode] = useState<'list' | 'table'>('list');
  const [tableDelimiter, setTableDelimiter] = useState(':');
  const [tableRemoveEssentials, setTableRemoveEssentials] = useState(true);
  const [tableRemovePrefixes, setTableRemovePrefixes] = useState('https://, http://, www.');
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isDeduping, setIsDeduping] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const yieldToUI = useCallback(() => new Promise<void>(r => requestAnimationFrame(() => r())), []);

  useEffect(() => {
    if (!saveFeedback) return;
    const t = setTimeout(() => setSaveFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [saveFeedback]);

  useEffect(() => {
    if (options.regex && options.wholeWord) setOptions(p => ({ ...p, wholeWord: false }));
  }, [options.regex]);

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
      const restored = loadSelectedFilesForPath(data.path);
      const valid = [...restored].filter(p => data.files.some((f: { path: string }) => f.path === p));
      setSelectedFiles(new Set(valid));
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
      const restored = loadSelectedFilesForPath(data.path);
      const valid = [...restored].filter(p => data.files.some((f: { path: string }) => f.path === p));
      setSelectedFiles(new Set(valid));
    }).catch(() => {
      setCurrentPath('');
      setLoadError('Local server not running. Run start.bat or "npm run dev:all", then click Retry.');
    });
  }, []);

  useEffect(() => {
    if (currentPath) saveSelectedFilesForPath(currentPath, selectedFiles);
  }, [currentPath, selectedFiles]);

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
    const val = queryInput;
    const cursor = queryRef.current?.selectionStart ?? val.length;
    const left = val.slice(0, cursor);
    const tokenStart = Math.max(left.lastIndexOf(' '), left.lastIndexOf(',')) + 1;
    const newVal = val.slice(0, tokenStart) + sug + ' ' + val.slice(cursor);
    setQueryInput(newVal);
    setSuggestions([]);
    setTimeout(() => {
      const pos = tokenStart + sug.length + 1;
      queryRef.current?.setSelectionRange(pos, pos);
      queryRef.current?.focus();
    }, 0);
  };

  const handleQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (selectedChipIndices.size > 0) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteChipSelected(selectedChipIndices);
        setSelectedChipIndices(new Set());
        return;
      }
      if (e.ctrlKey && (e.key === 'c' || e.key === 'x')) {
        e.preventDefault();
        handleCopyChipSelected(selectedChipIndices);
        if (e.key === 'x') {
          handleDeleteChipSelected(selectedChipIndices);
          setSelectedChipIndices(new Set());
        }
        return;
      }
      if (e.key === 'Escape') {
        setSelectedChipIndices(new Set());
        return;
      }
    }
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

  const buildQueryString = () => {
    const parts = [...queryChips];
    if (queryInput.trim()) parts.push(queryInput.trim());
    return parts.join(', ');
  };

  const buildExcludeString = () => excludeChips.join(', ');

  const handleCopyQuery = async () => {
    const q = buildQueryString();
    if (!q.trim()) {
      setStatus('No query to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(q);
      setStatus('Query copied to clipboard');
      setSaveFeedback({ type: 'success', message: 'Query copied. Paste into Load to restore later.' });
    } catch {
      setStatus('Failed to copy');
    }
  };

  const handleLoadQuery = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parts = splitToValues(text);
      if (parts.length === 0) {
        setStatus('Clipboard empty or no valid values');
        return;
      }
      setQueryChips(parts);
      setQueryInput('');
      updateSuggestions('');
      setStatus(`Loaded ${parts.length} term${parts.length === 1 ? '' : 's'}`);
      setSaveFeedback({ type: 'success', message: `Loaded query: ${parts.join(', ')}` });
    } catch {
      setStatus('Failed to read clipboard (check permissions)');
    }
  };

  const handleCopyChipSelected = useCallback((indices: Set<number>) => {
    const arr = Array.from(indices).sort((a, b) => a - b).map(i => queryChips[i]);
    const text = arr.join(', ');
    navigator.clipboard.writeText(text).then(() => setStatus(`Copied ${arr.length} chip${arr.length === 1 ? '' : 's'}`));
  }, [queryChips]);

  const handleDeleteChipSelected = useCallback((indices: Set<number>) => {
    setQueryChips(prev => prev.filter((_, i) => !indices.has(i)));
    setSelectedChipIndices(new Set());
  }, []);

  const handleSearch = () => {
    const queryStr = buildQueryString();
    if (queryInput.trim()) {
      const trimmed = queryInput.trim();
      if (!queryChips.includes(trimmed)) setQueryChips(prev => [...prev, trimmed]);
      setQueryInput('');
      updateSuggestions('');
    }
    const selectedPathsHere = files.filter(f => selectedFiles.has(f.path)).map(f => f.path);
    if (selectedPathsHere.length === 0) {
      setSaveFeedback({ type: 'error', message: 'No files selected. Select files in the Files panel before searching.' });
      setStatus('Select files to search');
      return;
    }
    setSuggestions([]);
    setIsSearching(true);
    setStatus('Searching...');
    setProgress(0);
    setFilesDone(0);
    setTotalFiles(0);
    setFileProgress(0);
    setScanningFile(null);
    resultsRef.current = [];
    setResultCount(0);
    setPage(1);
    setSearchTimeMs(0);

    const filesToSearch = selectedPathsHere;

    let count = 0;
    lastCountUpdateRef.current = Date.now();
    api.runSearch(
      { query: queryStr.trim(), exclude: buildExcludeString(), maxResults: Math.min(maxResults, 500000),
        options: { caseSensitive: options.caseSensitive, wholeWord: options.wholeWord, regex: options.regex },
        basePath: currentPath, filePaths: filesToSearch, concurrencyHint: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined },
      {
        onResult: (r) => {
          count++;
          resultsRef.current.push({ id: String(count), line: r.line, content: r.content, file: r.file, selected: false });
          const now = Date.now();
          if (count <= 20 || now - lastCountUpdateRef.current >= 100 || (count % 2000 === 0)) {
            lastCountUpdateRef.current = now;
            setResultCount(count);
          }
        },
        onProgress: (data) => {
          setProgress(data.pct);
          setFilesDone(data.filesDone ?? 0);
          setTotalFiles(data.totalFiles ?? 0);
          if (data.file) {
            setScanningFile(data.file);
            setFileProgress(data.filePct ?? 0);
          } else {
            setScanningFile(null);
            setFileProgress(data.filePct ?? 0);
          }
        },
        onDone: data => {
          setIsSearching(false);
          setProgress(100);
          setScanningFile(null);
          setFileProgress(100);
          setResultCount(resultsRef.current.length);
          setStatus(data.error ? data.error : 'Ready');
          if (data.timeMs != null) setSearchTimeMs(data.timeMs);
        },
      }
    );
  };

  const handleStop = () => { api.stopSearch().then(() => { setIsSearching(false); setStatus('Stopped'); setResultCount(resultsRef.current.length); }); };

  const handleClear = () => { resultsRef.current = []; setResultCount(0); setPage(1); setStatus('Idle'); setProgress(0); setFileProgress(0); setScanningFile(null); setFilesDone(0); setTotalFiles(0); setSearchTimeMs(0); };

  const toggleResultSelected = (id: string) => {
    const r = resultsRef.current.find(x => x.id === id);
    if (r) r.selected = !r.selected;
    setResultCount(c => c);  // force re-render
  };

  const handleDownloadResults = async () => {
    const results = resultsRef.current;
    if (results.length === 0) {
      setStatus('No results to save');
      setSaveFeedback({ type: 'error', message: 'No results to save.' });
      return;
    }
    const total = results.length;
    const toExport = total > MAX_EXPORT_ROWS ? results.slice(0, MAX_EXPORT_ROWS) : results;
    const capped = total > MAX_EXPORT_ROWS;
    setIsExporting(true);
    setStatus('Preparing export…');

    const CHUNK = 3000;
    let rows: (string | number)[][];

    try {
      if (resultsViewMode === 'table') {
        const delim = tableDelimiter || ':';
        const dataRows: string[][] = [];
        for (let i = 0; i < toExport.length; i++) {
          const r = toExport[i];
          let text = r.content;
          if (tableRemoveEssentials && tableRemovePrefixes.trim()) text = removePrefixesFromText(text, tableRemovePrefixes);
          const cells = delim ? text.split(delim).map(c => c.trim()) : [text];
          dataRows.push(cells);
          if (i > 0 && i % CHUNK === 0 && i < toExport.length - 1) {
            setStatus(`Preparing export… ${Math.round((i / toExport.length) * 100)}%`);
            await yieldToUI();
          }
        }
        const activeCols = getActiveColIndices(dataRows);
        if (activeCols.length > 0) {
          const header = activeCols.map((_, i) => `Col ${i + 1}`);
          rows = [header];
          for (let i = 0; i < dataRows.length; i++) {
            rows.push(activeCols.map(col => dataRows[i][col] ?? ''));
            if (i > 0 && i % CHUNK === 0 && i < dataRows.length - 1) {
              setStatus(`Preparing export… ${Math.round((i / dataRows.length) * 100)}%`);
              await yieldToUI();
            }
          }
        } else {
          rows = [['Content'], ...toExport.map(r => [r.content])];
        }
      } else {
        if (display.contentOnly) {
          rows = [['Content']];
          for (let i = 0; i < toExport.length; i++) {
            rows.push([toExport[i].content]);
            if (i > 0 && i % CHUNK === 0 && i < toExport.length - 1) {
              setStatus(`Preparing export… ${Math.round((i / results.length) * 100)}%`);
              await yieldToUI();
            }
          }
} else {
        rows = [['File', 'Line', 'Content']];
        for (let i = 0; i < toExport.length; i++) {
          const r = toExport[i];
          rows.push([r.file, r.line ?? '', r.content]);
          if (i > 0 && i % CHUNK === 0 && i < toExport.length - 1) {
            setStatus(`Preparing export… ${Math.round((i / toExport.length) * 100)}%`);
            await yieldToUI();
          }
        }
      }
      }

      setStatus('Writing file…');
      await yieldToUI();

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Results');
      XLSX.writeFile(wb, 'search_results.xlsx');

      setStatus(`Saved ${toExport.length}${capped ? ` (first ${MAX_EXPORT_ROWS.toLocaleString()} of ${total.toLocaleString()})` : ''} results as Excel`);
      setSaveFeedback({
        type: 'success',
        message: capped
          ? `Exported first ${MAX_EXPORT_ROWS.toLocaleString()} of ${total.toLocaleString()} results. Use filters or reduce max results to export more.`
          : `Saved ${total} results as search_results.xlsx. Use the browser's dialog to choose where to save.`,
      });
    } catch (err) {
      setStatus('Export failed');
      setSaveFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
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
    const results = resultsRef.current;
    if (results.length === 0) return;
    const contentOnly = display.contentOnly;
    const CHUNK = 5000;
    if (results.length > CHUNK) setStatus('Copying…');
    const parts: string[] = [];
    for (let i = 0; i < results.length; i += CHUNK) {
      const slice = results.slice(i, i + CHUNK);
      parts.push(contentOnly
        ? slice.map(r => r.content).join('\n')
        : slice.map(r => `${r.file}\t${r.line}\t${r.content}`).join('\n'));
      if (i + CHUNK < results.length) await yieldToUI();
    }
    const text = parts.join('\n');
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${results.length} rows`);
  };

  const handleCopyTableAsTsv = useCallback(async () => {
    const delim = tableDelimiter || ':';
    const results = resultsRef.current;
    const removeEss = tableRemoveEssentials && tableRemovePrefixes.trim();
    const prefixes = tableRemovePrefixes;
    const CHUNK = 5000;
    if (results.length > CHUNK) setStatus('Copying table…');
    const dataRows: string[][] = [];
    for (let i = 0; i < results.length; i++) {
      let text = results[i].content;
      if (removeEss && prefixes) text = removePrefixesFromText(text, prefixes);
      const cells = delim ? text.split(delim).map(c => c.trim()) : [text];
      dataRows.push(cells);
      if (i > 0 && i % CHUNK === 0 && i < results.length - 1) await yieldToUI();
    }
    const activeCols = getActiveColIndices(dataRows);
    const rowStrings: string[] = [];
    if (activeCols.length > 0) {
      for (let i = 0; i < dataRows.length; i++) {
        rowStrings.push(activeCols.map(col => dataRows[i][col] ?? '').join('\t'));
        if (i > 0 && i % CHUNK === 0 && i < dataRows.length - 1) await yieldToUI();
      }
    } else {
      for (let i = 0; i < dataRows.length; i++) {
        rowStrings.push(dataRows[i][0] ?? '');
        if (i > 0 && i % CHUNK === 0 && i < dataRows.length - 1) await yieldToUI();
      }
    }
    const tsv = rowStrings.join('\n');
    await navigator.clipboard.writeText(tsv);
    setStatus(`Copied table (${dataRows.length} rows) as TSV for Excel`);
  }, [tableDelimiter, tableRemoveEssentials, tableRemovePrefixes, yieldToUI]);

  const handleTableCellEdit = useCallback((rowIdx: number, colIdx: number, value: string) => {
    const r = resultsRef.current[rowIdx];
    if (!r) return;
    const delim = tableDelimiter || ':';
    let raw = r.content;
    if (tableRemoveEssentials && tableRemovePrefixes.trim()) raw = removePrefixesFromText(raw, tableRemovePrefixes);
    const cells = delim ? raw.split(delim).map(c => c.trim()) : [raw];
    while (cells.length <= colIdx) cells.push('');
    cells[colIdx] = value;
    r.content = cells.join(delim);
    setResultsVersion(v => v + 1);
  }, [tableDelimiter, tableRemoveEssentials, tableRemovePrefixes]);

  const handleTableDeleteRow = useCallback((rowIdx: number) => {
    resultsRef.current.splice(rowIdx, 1);
    setResultCount(c => c - 1);
    setResultsVersion(v => v + 1);
    if (page > 1 && (page - 1) * RESULTS_PER_PAGE >= resultsRef.current.length) setPage(p => Math.max(1, p - 1));
  }, [page]);

  const handleTableDeleteColumn = useCallback(async (colIdx: number) => {
    const delim = tableDelimiter || ':';
    const results = resultsRef.current;
    const removeEss = tableRemoveEssentials && tableRemovePrefixes.trim();
    const prefixes = tableRemovePrefixes;
    const CHUNK = 5000;
    if (results.length > CHUNK) setStatus('Updating table…');
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      let raw = r.content;
      if (removeEss && prefixes) raw = removePrefixesFromText(raw, prefixes);
      const cells = delim ? raw.split(delim).map(c => c.trim()) : [raw];
      if (colIdx < cells.length) {
        cells.splice(colIdx, 1);
        r.content = cells.join(delim);
      }
      if (i > 0 && i % CHUNK === 0 && i < results.length - 1) await yieldToUI();
    }
    setResultsVersion(v => v + 1);
  }, [tableDelimiter, tableRemoveEssentials, tableRemovePrefixes, yieldToUI]);

  const handleSort = () => {
    const dir = sortOrder === 'az' ? 1 : -1;
    const by = sortBy;
    const results = resultsRef.current;
    if (results.length === 0) return;
    setStatus('Sorting…');
    requestAnimationFrame(() => {
      results.sort((a, b) => {
        if (by === 'content') {
          return (a.content.localeCompare(b.content, undefined, { sensitivity: 'base' }) || 0) * dir;
        }
        const f = a.file.localeCompare(b.file) * dir;
        return f !== 0 ? f : ((a.line ?? 0) - (b.line ?? 0)) * dir;
      });
      setSortOrder(s => s === 'az' ? 'za' : 'az');
      setResultCount(c => c);
      setResultsVersion(v => v + 1);
      setStatus(by === 'content' ? (sortOrder === 'az' ? 'Sorted by content A-Z' : 'Sorted by content Z-A') : (sortOrder === 'az' ? 'Sorted by file A-Z' : 'Sorted by file Z-A'));
    });
  };

  const handleDeduplicate = async () => {
    const results = resultsRef.current;
    const before = results.length;
    if (before === 0) {
      setStatus('No results to deduplicate');
      return;
    }

    setIsDeduping(true);
    setStatus('Deduplicating…');

    const contentOnly = display.contentOnly;
    const normalizeContent = (s: string) => s.replace(/\r\n|\r/g, '\n').trim();
    const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase().trim();
    const lineStr = (line: number | null) => (line == null ? '' : String(line));

    const seen = new Set<string>();
    const kept: SearchResult[] = [];
    const CHUNK = 10000;
    const yieldToUI = () => new Promise<void>(r => requestAnimationFrame(() => r()));

    const makeKey = (r: SearchResult) => {
      const content = normalizeContent(r.content);
      if (contentOnly) return content;
      return `${normalizePath(r.file)}\t${lineStr(r.line)}\t${content}`;
    };

    try {
      for (let i = 0; i < results.length; i++) {
        const k = makeKey(results[i]);
        if (!seen.has(k)) {
          seen.add(k);
          kept.push(results[i]);
        }
        if (i > 0 && i % CHUNK === 0 && i < results.length - 1) {
          setStatus(`Deduplicating… ${Math.round((i / results.length) * 100)}%`);
          await yieldToUI();
        }
      }

      resultsRef.current = kept;
      const after = kept.length;
      const removed = before - after;
      setResultCount(after);
      setResultsVersion(v => v + 1);
      setPage(1);
      const mode = contentOnly ? ' (content only)' : '';
      const msg = removed === 0 ? `No duplicates found${mode}` : `Removed ${removed} duplicate${removed === 1 ? '' : 's'} (${after} remaining)${mode}`;
      setStatus(msg);
      setSaveFeedback(removed > 0 ? { type: 'success', message: msg } : null);
    } finally {
      setIsDeduping(false);
    }
  };

  const handleReplace = async () => {
    if (!replaceFind.trim()) return;
    const results = resultsRef.current;
    const find = replaceFind;
    const repl = replaceWith;
    setShowReplaceModal(false);
    setReplaceFind('');
    setReplaceWith('');
    if (results.length > 5000) {
      setStatus('Replacing…');
      const CHUNK = 5000;
      for (let i = 0; i < results.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, results.length);
        for (let j = i; j < end; j++) results[j].content = results[j].content.split(find).join(repl);
        if (end < results.length) {
          setStatus(`Replacing… ${Math.round((end / results.length) * 100)}%`);
          await yieldToUI();
        }
      }
    } else {
      for (const r of results) r.content = r.content.split(find).join(repl);
    }
    setResultCount(c => c);
    setStatus('Replaced');
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
    <div className="flex flex-col h-screen text-slate-200 font-sans overflow-hidden selection:bg-blue-500/30">

      <div className="flex items-center gap-1.5 p-2 bg-slate-900/50 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-black/20 z-10">
        <motion.button onClick={goBack} disabled={navHistory.length === 0} whileTap={{ scale: 0.9 }} className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 transition-colors" title="Back"><ChevronLeft size={16} /></motion.button>
        <motion.button onClick={goForward} disabled={navFuture.length === 0} whileTap={{ scale: 0.9 }} className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 transition-colors" title="Forward"><ChevronRight size={16} /></motion.button>
        <motion.button onClick={goUp} whileTap={{ scale: 0.9 }} className="p-1.5 rounded hover:bg-white/10 shrink-0 transition-colors" title="Up one level"><ArrowUp size={16} /></motion.button>

        <input type="text" value={mapDirInput} onChange={e => setMapDirInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigateTo(mapDirInput.trim())}
          placeholder="Type or paste path, press Enter"
          className="flex-1 min-w-0 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-blue-500/40 focus:border-blue-500/50 outline-none" />

        <motion.button onClick={handleBrowseFolder} disabled={isBrowsing} whileTap={{ scale: 0.96 }} whileHover={isBrowsing ? {} : { scale: 1.02 }}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all backdrop-blur-sm ${isBrowsing ? 'bg-blue-600 text-white animate-pulse cursor-wait' : 'bg-white/10 hover:bg-white/15 text-slate-200 border border-white/10 hover:border-white/20'}`}
          title="Open folder picker dialog">
          <FolderOpen size={14} /> {isBrowsing ? 'Opening…' : 'Browse'}
        </motion.button>

        <motion.button onClick={() => setShowFilesModal(true)} whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.02 }} className="px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-500 backdrop-blur-sm rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all shadow-lg shadow-emerald-900/30 border border-emerald-500/30">
          <FileText size={14} /> Files
        </motion.button>

        <div className="px-2.5 py-1 bg-white/5 backdrop-blur-sm rounded-lg text-[11px] font-mono text-slate-400 border border-white/10 shrink-0">{badgeText}</div>

        {loadError && <motion.button onClick={() => navigateTo(defaultRoot || '')} whileTap={{ scale: 0.95 }} className="px-2 py-1 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded text-xs font-semibold shrink-0 transition-colors">Retry</motion.button>}
      </div>

      <div className="flex-none flex flex-col gap-2.5 p-3 overflow-y-auto max-h-[38vh] mx-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-100"><Search size={16} className="text-blue-400" /> Search Query</label>
            <div className="flex items-center gap-1.5">
              <motion.button whileTap={{ scale: 0.95 }} onClick={handleCopyQuery} disabled={!buildQueryString().trim()} title="Copy query to clipboard (save for later)" className="p-1.5 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"><Copy size={14} /></motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={handleLoadQuery} title="Load query from clipboard (paste saved query)" className="p-1.5 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"><ClipboardPaste size={14} /></motion.button>
            </div>
            <div className="text-[10px] text-slate-500 font-mono tracking-wide">Comma/Tab = chip · Enter = search · Copy/Load to save & restore · Click chips to select, Ctrl+C/X/Del to copy/cut/delete</div>
          </div>
          <div className="relative flex items-start gap-2">
            <SearchChipInput
              chips={queryChips}
              setChips={setQueryChips}
              inputValue={queryInput}
              setInputValue={setQueryInput}
              onInputChange={updateSuggestions}
              onKeyDown={handleQueryKeyDown}
              onBlur={() => setTimeout(() => setSuggestions([]), 150)}
              inputRef={queryRef}
              placeholder="Type domain or keyword… (comma/tab = new value)"
              suggestions={suggestions}
              sugIdx={sugIdx}
              acceptSuggestion={acceptSuggestion}
              selectedIndices={selectedChipIndices}
              onSelectionChange={setSelectedChipIndices}
              onCopySelected={handleCopyChipSelected}
              onDeleteSelected={handleDeleteChipSelected}
              className="flex-1"
            />
            <button className="p-2 hover:bg-white/10 rounded-lg text-slate-500 hover:text-slate-300 shrink-0 transition-colors" title="Help" onClick={() => setShowHelp(true)}><AlertCircle size={16} /></button>
          </div>
          {buildQueryString().trim() && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-900/30 backdrop-blur-md rounded-xl border border-white/10">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">Logic:</span>
              <QueryPreview query={buildQueryString()} className="flex-1 min-w-0" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider"><Ban size={12} className="text-red-400" /> Exclude (comma/tab = new value)</label>
            <ExcludeChipInput chips={excludeChips} setChips={setExcludeChips} placeholder="spam, test, junk" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Max Results</label>
            <input type="number" value={maxResults} onChange={e => setMaxResults(Math.max(1, parseInt(e.target.value) || 100000))}
              className="w-32 bg-white/5 backdrop-blur-sm border border-white/10 text-slate-300 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-500/30 outline-none font-mono" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleChip label="Regex" icon={Regex} active={options.regex} onClick={() => setOptions(p => ({...p, regex: !p.regex, wholeWord: p.regex ? p.wholeWord : false}))} title="Use regex patterns in query" />
            <ToggleChip label="Case sensitive" icon={CaseSensitive} active={options.caseSensitive} onClick={() => setOptions(p => ({...p, caseSensitive: !p.caseSensitive}))} title="Match exact letter case" />
            <ToggleChip label="Whole word" icon={WholeWord} active={options.wholeWord} onClick={() => setOptions(p => ({...p, wholeWord: !p.wholeWord}))} disabled={options.regex} title={options.regex ? "Disabled when Regex is on" : "Match complete words only"} />
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-400 bg-slate-900/30 backdrop-blur-md p-1.5 rounded-xl border border-white/10">
            <span className="font-semibold px-1 text-slate-500 uppercase tracking-wider text-[10px]">Results:</span>
            <label className="flex items-center gap-1 cursor-pointer hover:text-slate-200" title="Show row number">
              <input type="checkbox" checked={display.showNumber} onChange={e => setDisplay(p => ({...p, showNumber: e.target.checked}))} className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-0 focus:ring-offset-0" />
              <Hash size={12} /> #
            </label>
            <label className="flex items-center gap-1 cursor-pointer hover:text-slate-200" title="Show line number in file">
              <input type="checkbox" checked={display.showLine} onChange={e => setDisplay(p => ({...p, showLine: e.target.checked}))} className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-0 focus:ring-offset-0" />
              <List size={12} /> Line
            </label>
            <label className="flex items-center gap-1 cursor-pointer hover:text-slate-200" title="Show file name">
              <input type="checkbox" checked={display.showFile} onChange={e => setDisplay(p => ({...p, showFile: e.target.checked}))} className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-0 focus:ring-offset-0" />
              <FileCode size={12} /> File
            </label>
            <div className="w-px h-3 bg-white/20" />
            <label className="flex items-center gap-1 cursor-pointer hover:text-slate-200" title="Show only matched text (no file/line)">
              <input type="checkbox" checked={display.contentOnly} onChange={e => setDisplay(p => ({...p, contentOnly: e.target.checked}))} className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-0 focus:ring-offset-0" />
              <AlignJustify size={12} /> Content only
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          <IconButton icon={Search} label="Search" variant="primary" onClick={handleSearch} disabled={isSearching} />
          <IconButton icon={Square} label="Stop" variant="danger" onClick={handleStop} disabled={!isSearching} />
          <IconButton icon={Download} label={isExporting ? 'Exporting…' : 'Quick Save'} variant="success" className="bg-emerald-700 hover:bg-emerald-600" onClick={handleDownloadResults} disabled={isExporting} title="Save as Excel (.xlsx) — table columns or single column based on current view" />
          <IconButton icon={Copy} label="Copy Sel" variant="info" onClick={handleCopySelected} />
          <IconButton icon={CopyCheck} label="Copy All" variant="info" className="bg-cyan-700 hover:bg-cyan-600" onClick={handleCopyAll} />
          <IconButton icon={X} label="Clear" variant="warning" onClick={handleClear} />
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2"><Settings2 size={14} /> Tools:</div>
          <div className="flex gap-2">
            <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }} onClick={() => setSortBy(s => s === 'content' ? 'file' : 'content')} title={`Sort by: ${sortBy} (click to switch)`} className="px-2 py-1 rounded text-slate-500 hover:text-slate-300 text-[10px] uppercase">{sortBy}</motion.button>
            <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }} className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 active:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors" onClick={handleSort} title={sortOrder === 'az' ? 'Sort A-Z (next click: Z-A)' : 'Sort Z-A (next click: A-Z)'}><ArrowDownAZ size={14} /> Sort {sortOrder === 'az' ? 'A→Z' : 'Z→A'}</motion.button>
            <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }} className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 active:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors" onClick={() => setShowReplaceModal(true)}><Replace size={14} /> Replace</motion.button>
            <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }} disabled={isDeduping} title={display.contentOnly ? 'Remove duplicates by full line (same url:user:pass = duplicate; same url, different user/pass = keep both)' : 'Remove duplicates by file + line + full content'} className={`px-3 py-1.5 bg-teal-500/10 hover:bg-teal-500/20 active:bg-teal-500/30 text-teal-300 border border-teal-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${isDeduping ? 'opacity-60 cursor-wait' : ''}`} onClick={handleDeduplicate}><Trash2 size={14} /> {isDeduping ? 'Deduplicating…' : 'Deduplicate'}</motion.button>
            <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }} disabled={resultCount === 0} title="Split results by delimiter into table view (default :)" className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${resultsViewMode === 'table' ? 'bg-violet-500/30 border-violet-500 text-violet-200' : 'bg-violet-500/10 hover:bg-violet-500/20 active:bg-violet-500/30 text-violet-300 border border-violet-500/30'}`} onClick={() => setResultsViewMode(m => m === 'table' ? 'list' : 'table')}><LayoutGrid size={14} /> {resultsViewMode === 'table' ? 'List View' : 'Table View'}</motion.button>
          </div>
        </div>
      </div>

      {saveFeedback && (
        <div className={`mx-4 mb-2 px-4 py-3 rounded-xl border flex items-center justify-between gap-3 shadow-xl backdrop-blur-xl ${saveFeedback.type === 'success' ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200' : 'bg-red-950/80 border-red-500/40 text-red-200'}`}>
          <span className="flex items-center gap-2 text-sm font-medium">
            {saveFeedback.type === 'success' ? <CheckCircle2 size={20} className="text-emerald-400 shrink-0" /> : <AlertCircle size={20} className="text-red-400 shrink-0" />}
            {saveFeedback.message}
          </span>
          <button type="button" onClick={() => setSaveFeedback(null)} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200" aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="px-4 pb-1.5 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500 shrink-0 w-14">Overall</span>
          <div className="flex-1 min-w-0 h-2 bg-white/10 backdrop-blur-sm rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 60, damping: 28 }}
              style={{ boxShadow: '0 0 12px rgba(59,130,246,0.4)' }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">{progress}%</span>
        </div>
        {isSearching && scanningFile && totalFiles > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wider text-slate-500 shrink-0 w-14">Current file</span>
            <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden max-w-[200px]">
              <motion.div
                className="h-full bg-cyan-500/70 rounded-full"
                animate={{ width: `${fileProgress}%` }}
                transition={{ type: 'spring', stiffness: 80, damping: 25 }}
              />
            </div>
            <span className="text-[9px] text-slate-500 truncate max-w-[140px]" title={scanningFile}>{scanningFile} ({fileProgress}%)</span>
          </div>
        )}
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
            {isSearching ? <Play size={10} className="text-blue-400 animate-pulse" /> : <CheckCircle2 size={10} className="text-emerald-500" />}{status}
          </span>
          {isSearching && totalFiles > 0 && (
            <span className="text-[10px] font-mono text-slate-400">
              Files: <span className="text-emerald-500/90">{filesDone}</span> done · <span className="text-amber-500/90">{Math.max(0, totalFiles - filesDone)}</span> remaining
              {scanningFile && <span className="text-blue-400/90 ml-1">· scanning {scanningFile}</span>}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-slate-900/40 backdrop-blur-xl mx-4 mb-0 border-x border-t border-white/10 rounded-t-xl overflow-hidden flex flex-col shadow-xl shadow-black/20">
        {resultsViewMode === 'table' && resultCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-slate-950/50 backdrop-blur-md border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Delimiter:</label>
              <input type="text" value={tableDelimiter} onChange={e => setTableDelimiter(e.target.value || ':')} placeholder=":" maxLength={4}
                className="w-14 bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg px-2 py-1 font-mono text-sm text-slate-200 text-center" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={tableRemoveEssentials} onChange={e => setTableRemoveEssentials(e.target.checked)} className="rounded border-white/20 bg-white/5 text-violet-500" />
              <span className="text-xs text-slate-400">Remove prefixes</span>
            </label>
            {tableRemoveEssentials && (
              <input type="text" value={tableRemovePrefixes} onChange={e => setTableRemovePrefixes(e.target.value)} placeholder="https://, http://, www."
                className="flex-1 min-w-[200px] max-w-[320px] bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-slate-300 placeholder-slate-500" title="Comma-separated prefixes to strip (editable)" />
            )}
            <motion.button whileTap={{ scale: 0.97 }} className="px-3 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 rounded text-xs font-medium border border-cyan-500/30" onClick={handleCopyTableAsTsv} title="Copy as TSV for Excel"><Copy size={14} /> Copy table</motion.button>
          </div>
        )}
        {resultsViewMode === 'list' && (
          <div className="flex items-center bg-slate-950/50 backdrop-blur-md border-b border-white/10 px-4 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider select-none shrink-0">
            {display.showNumber && <div className="w-12 shrink-0">#</div>}
            {display.showLine && <div className="w-16 shrink-0 text-right pr-4">Line</div>}
            <div className="flex-1">Content</div>
            {display.showFile && <div className="w-64 shrink-0 text-right">File</div>}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {resultCount === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-600 gap-3">
              <Search size={48} strokeWidth={1} className="opacity-20" />
              <p className="text-sm font-medium">No results. Enter a query and press Search.</p>
            </div>
          ) : resultsViewMode === 'table' ? (
            <TableViewContent
              results={resultsRef.current}
              delimiter={tableDelimiter || ':'}
              removeEssentials={tableRemoveEssentials}
              removePrefixesStr={tableRemovePrefixes}
              page={page}
              totalPages={totalPages}
              resultsVersion={resultsVersion}
              onPageChange={setPage}
              onCellEdit={handleTableCellEdit}
              onDeleteRow={handleTableDeleteRow}
              onDeleteColumn={handleTableDeleteColumn}
            />
          ) : (
            <>
              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {pageResults.map((res, idx) => (
                  <div key={res.id} onClick={() => toggleResultSelected(res.id)}
                    className={`flex items-center px-4 py-1 hover:bg-white/5 border-b border-white/5 text-sm font-mono cursor-pointer group transition-colors ${res.selected ? 'bg-blue-500/15 border-l-2 border-l-blue-500' : ''}`}>
                    {display.showNumber && <div className="w-12 shrink-0 text-slate-600 text-xs">{(page - 1) * RESULTS_PER_PAGE + idx + 1}</div>}
                    {display.showLine && <div className="w-16 shrink-0 text-right pr-4 text-emerald-600/80 group-hover:text-emerald-500">{res.line ?? '—'}</div>}
                    <div className="flex-1 truncate text-slate-300 group-hover:text-slate-100" title={res.content}>{res.content}</div>
                    {display.showFile && <div className="w-64 shrink-0 text-right text-slate-500 text-xs truncate pl-4 group-hover:text-slate-400" title={res.file}>{getFileName(res.file)}</div>}
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 py-1.5 border-t border-white/10 bg-slate-950/50 backdrop-blur-md text-xs shrink-0">
                  <motion.button onClick={() => setPage(1)} disabled={page === 1} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronsLeft size={14} /></motion.button>
                  <motion.button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronLeft size={14} /></motion.button>
                  <span className="text-slate-400 font-mono px-2">Page <span className="text-slate-200 font-bold">{page}</span> of <span className="text-slate-200 font-bold">{totalPages}</span></span>
                  <motion.button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronRight size={14} /></motion.button>
                  <motion.button onClick={() => setPage(totalPages)} disabled={page === totalPages} whileTap={{ scale: 0.9 }} className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"><ChevronsRight size={14} /></motion.button>
                  <span className="text-slate-500 ml-2">({RESULTS_PER_PAGE}/page)</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="bg-slate-950/60 backdrop-blur-xl border-t border-white/10 p-1.5 px-4 flex justify-between items-center text-xs font-mono text-slate-500 select-none">
        <div className="flex items-center gap-4">
          <span className="text-slate-400">Total: <span className="text-slate-200 font-bold">{resultCount.toLocaleString()}</span></span>
          {resultCount > 50000 && <span className="text-amber-500/90 text-[10px] ml-2" title="Export and copy are chunked; may take a while for very large sets">Large set</span>}
          <span>|</span>
          <span>Time: {(searchTimeMs / 1000).toFixed(2)}s</span>
          {totalPages > 1 && <><span>|</span><span>Page {page}/{totalPages}</span></>}
          {isSearching && scanningFile && <><span>|</span><span className="text-blue-400/80 truncate max-w-[280px]" title={scanningFile}>Scanning: {scanningFile}</span></>}
          {isSearching && totalFiles > 0 && <><span>|</span><span className="text-slate-400">Files: <span className="text-emerald-500">{filesDone}</span>/<span className="text-slate-200">{totalFiles}</span></span></>}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isSearching ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="uppercase tracking-wider">{isSearching ? 'Processing' : 'Idle'}</span>
        </div>
      </div>

      {showHelp && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowHelp(false)}>
          <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full p-6 text-sm text-slate-200 font-mono" onClick={e => e.stopPropagation()}>
            <h3 className="text-slate-100 font-bold uppercase tracking-wider mb-3">Query Syntax Guide</h3>
            <ul className="space-y-2 mb-4">
              <li><span className="text-blue-400 font-bold">AND</span> — all terms must match: <code className="text-slate-400">foo AND bar</code></li>
              <li><span className="text-emerald-400 font-bold">OR</span> — any term matches (default for multiple chips): <code className="text-slate-400">foo OR bar</code></li>
              <li><span className="text-red-400 font-bold">NOT</span> — exclude term: <code className="text-slate-400">foo AND NOT spam</code></li>
              <li><span className="text-cyan-400 font-bold">LIKE</span> — both parts must appear: <code className="text-slate-400">email LIKE @gmail</code></li>
              <li><span className="text-slate-500 font-bold">( )</span> — group expressions: <code className="text-slate-400">(a AND b) OR (c AND d)</code></li>
              <li><span className="text-amber-400 font-bold">*</span> wildcard (no Regex needed): <code className="text-slate-400">*</code> = &quot;any characters&quot;. Examples: <code className="text-slate-400">login*.com</code> matches login.example.com, login.site.com; <code className="text-slate-400">user*:pass</code> matches user123:pass, user:pass. Use one chip for the whole pattern.</li>
              <li><span className="text-purple-400 font-bold">Regex</span> toggle: turn <strong>Regex</strong> on for full regex in keywords. Examples: <code className="text-slate-400">login\.\w+\.com</code>, <code className="text-slate-400">\d{3}-\d{3}</code>, <code className="text-slate-400">[a-z]+@[a-z]+\.com</code>. With Regex off, use <code className="text-slate-400">*</code> for simple wildcards like <code className="text-slate-400">login*.om</code>.</li>
              <li><span className="text-amber-400 font-bold">Comma / multiple chips</span> = OR: <code className="text-slate-400">a, b, c</code></li>
              <li><strong>Exclude</strong> field: comma-separated keywords to skip matching lines</li>
              <li className="pt-2 border-t border-white/10 mt-2"><span className="text-slate-300 font-bold">Try these</span> — one chip each: <code className="text-slate-400">login*.com</code> · <code className="text-slate-400">login*.om</code> · <code className="text-slate-400">*:password</code> · <code className="text-slate-400">http*://*</code> · With Regex on: <code className="text-slate-400">login\.\w+\.(com|net)</code></li>
              <li><strong>Deduplicate</strong>: Removes duplicates. With "Content only" display: same text = duplicate. Otherwise: same file + line + content.</li>
              <li><strong>Chips</strong>: Type a value, then comma or Tab to add as a chip. Multiple chips = OR. Use <strong>one chip</strong> for AND: <code className="text-slate-400">test AND wifi</code> finds lines with both (e.g. <code className="text-slate-400">url:test:wifi</code>).</li>
              <li><strong>Copy/Load</strong>: Copy saves the query to clipboard. Load pastes and validates into chips. Use to save/restore queries.</li>
              <li><strong>Select chips</strong>: Click chips to select (Shift+click for range). Selected chips: <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-300">Ctrl+C</kbd> copy, <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-300">Ctrl+X</kbd> cut, <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-300">Del</kbd>/<kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-300">Backspace</kbd> delete. You can also drag to select text in chips and copy normally.</li>
              <li><strong>Table View</strong>: Toggle to show results as a table in the main area. Delimiter (default <code className="text-slate-400">:</code>) splits into columns. &quot;Remove prefixes&quot; strips editable comma-separated prefixes (e.g. <code className="text-slate-400">https://, http://, www.</code>). Cells are editable; delete rows (X on row) or columns (X on header). Paginated (200/page). Copy table as TSV for Excel.</li>
            </ul>
            <p className="text-slate-500 text-xs mb-1">Autocomplete: start typing an operator and press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-300">Tab</kbd> to accept.</p>
            <p className="text-slate-500 text-xs">All processing is local on your PC. Results are paginated ({RESULTS_PER_PAGE}/page) for stability.</p>
            <motion.button className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-sm transition-colors backdrop-blur-sm" whileTap={{ scale: 0.98 }} onClick={() => setShowHelp(false)}>Close</motion.button>
          </div>
        </div>
      )}

      {showFilesModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowFilesModal(false)}>
          <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 font-bold text-slate-200 uppercase tracking-wider text-xs">Select files to search in {getFileName(currentPath)}</div>
            <div className="p-2 overflow-y-auto flex-1">
              {files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => (
                <label key={f.path} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/10 cursor-pointer text-sm font-mono text-slate-300 transition-colors">
                  <input type="checkbox" checked={selectedFiles.has(f.path)} onChange={() => setSelectedFiles(prev => { const n = new Set(prev); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })} className="rounded border-white/20 bg-white/5 text-blue-500" />
                  {f.name} <span className="text-slate-500 text-xs">({formatSize(f.size)})</span>
                </label>
              ))}
              {files.filter(f => f.name.toLowerCase().endsWith('.txt')).length === 0 && <p className="text-slate-500 text-sm p-2">No .txt files in this folder</p>}
            </div>
            <div className="flex gap-2 p-3 border-t border-white/10">
              <motion.button whileTap={{ scale: 0.97 }} className="px-4 py-2 bg-blue-600/90 hover:bg-blue-500 backdrop-blur-sm rounded-xl text-sm font-semibold transition-colors border border-blue-500/30" onClick={() => { setSelectedFiles(new Set(files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => f.path))); }}>Select All</motion.button>
              <motion.button whileTap={{ scale: 0.97 }} className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-sm transition-colors backdrop-blur-sm" onClick={() => { setSelectedFiles(new Set()); }}>Clear All</motion.button>
              <div className="flex-1" />
              <motion.button whileTap={{ scale: 0.97 }} className="px-4 py-2 bg-emerald-600/90 hover:bg-emerald-500 backdrop-blur-sm rounded-xl text-sm font-semibold transition-colors border border-emerald-500/30" onClick={() => setShowFilesModal(false)}>Done</motion.button>
            </div>
          </div>
        </div>
      )}

      {showReplaceModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowReplaceModal(false)}>
          <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-slate-100 font-bold uppercase tracking-wider text-xs mb-4">Replace in results</h3>
            <input type="text" value={replaceFind} onChange={e => setReplaceFind(e.target.value)} placeholder="Find" className="w-full bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 mb-2 font-mono text-sm" />
            <input type="text" value={replaceWith} onChange={e => setReplaceWith(e.target.value)} placeholder="Replace with" className="w-full bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 mb-4 font-mono text-sm" />
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.97 }} className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-sm transition-colors backdrop-blur-sm" onClick={() => setShowReplaceModal(false)}>Cancel</motion.button>
              <motion.button whileTap={{ scale: 0.97 }} className="px-4 py-2 bg-blue-600/90 hover:bg-blue-500 backdrop-blur-sm rounded-xl text-sm font-semibold transition-colors border border-blue-500/30" onClick={handleReplace}>Replace All</motion.button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

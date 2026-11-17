import * as vscode from 'vscode';

/** Language -> comment delimiters. Keep this table as the single source of truth. */
export interface LangConfig {
  line?: string[];
  block?: Array<[string, string]>;
}

export const LANGUAGE_CONFIG: Record<string, LangConfig> = {
  javascript: { line: ['//'], block: [['/*', '*/']] },
  javascriptreact: { line: ['//'], block: [['/*', '*/']] },
  typescript: { line: ['//'], block: [['/*', '*/']] },
  typescriptreact: { line: ['//'], block: [['/*', '*/']] },
  vue: { line: ['//'], block: [['/*', '*/'], ['<!--', '-->']] },
  svelte: { line: ['//'], block: [['/*', '*/'], ['<!--', '-->']] },
  astro: { line: ['//'], block: [['/*', '*/'], ['<!--', '-->']] },
  java: { line: ['//'], block: [['/*', '*/']] },
  c: { line: ['//'], block: [['/*', '*/']] },
  cpp: { line: ['//'], block: [['/*', '*/']] },
  csharp: { line: ['//'], block: [['/*', '*/']] },
  'objective-c': { line: ['//'], block: [['/*', '*/']] },
  objective_c: { line: ['//'], block: [['/*', '*/']] },
  'objective-cpp': { line: ['//'], block: [['/*', '*/']] },
  go: { line: ['//'], block: [['/*', '*/']] },
  rust: { line: ['//'], block: [['/*', '*/']] },
  swift: { line: ['//'], block: [['/*', '*/']] },
  kotlin: { line: ['//'], block: [['/*', '*/']] },
  scala: { line: ['//'], block: [['/*', '*/']] },
  dart: { line: ['//'], block: [['/*', '*/']] },
  groovy: { line: ['//'], block: [['/*', '*/']] },
  coffeescript: { line: ['#'], block: [['###', '###']] },
  php: { line: ['//', '#'], block: [['/*', '*/']] },
  css: { block: [['/*', '*/']] },
  scss: { line: ['//'], block: [['/*', '*/']] },
  less: { line: ['//'], block: [['/*', '*/']] },
  html: { block: [['<!--', '-->']] },
  xml: { block: [['<!--', '-->']] },
  handlebars: { block: [['{{!--', '--}}'], ['{{!', '}}']] },
  python: { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]] },
  ruby: { line: ['#'], block: [['=begin', '=end']] },
  shellscript: { line: ['#'] },
  powershell: { line: ['#'], block: [['<#', '#>']] },
  yaml: { line: ['#'] },
  dockerfile: { line: ['#'] },
  makefile: { line: ['#'] },
  perl: { line: ['#'], block: [['=pod', '=cut']] },
  r: { line: ['#'] },
  lua: { line: ['--'], block: [['--[[', ']]']] },
  haskell: { line: ['--'], block: [['{-', '-}']] },
  elixir: { line: ['#'] },
  erlang: { line: ['%'] },
  clojure: { line: [';'] },
  sql: { line: ['--'], block: [['/*', '*/']] },
  json: { block: [] },
  jsonc: { line: ['//'], block: [['/*', '*/']] },
  ini: { line: ['#', ';'] },
  properties: { line: ['#', '!'] },
  toml: { line: ['#'] },
  bat: { line: ['REM', '::'] },
  latex: { line: ['%'] },
};

const FALLBACK: LangConfig = {
  line: ['//', '#', '--', ';', '%'],
  block: [['/*', '*/'], ['<!--', '-->'], ['"""', '"""'], ["'''", "'''"], ['--[[', ']]'], ['{-', '-}'], ['<#', '#>']],
};

// ---------------------------------------------------------------------------
// Public API — only these two are used by extension.ts
// ---------------------------------------------------------------------------

export async function stripComments(doc: vscode.TextDocument): Promise<string> {
  const ranges = await getCommentRanges(doc);
  if (ranges.length === 0) return doc.getText();
  return stripWithRanges(doc, ranges);
}

export async function getCommentRanges(doc: vscode.TextDocument): Promise<vscode.Range[]> {
  // Semantic tokens are string-aware and language-agnostic — use when available.
  const semantic = await trySemanticTokens(doc);
  if (semantic && semantic.length > 0) return mergeRanges(semantic);

  const cfg = LANGUAGE_CONFIG[doc.languageId] ?? FALLBACK;
  const effective: LangConfig = {
    line: cfg.line ?? FALLBACK.line,
    block: cfg.block ?? FALLBACK.block,
  };
  // Always support HTML comments as embedded (e.g. Vue, Astro)
  if (cfg.block && !cfg.block.some(b => b[0] === '<!--')) {
    effective.block = [...cfg.block!, ['<!--', '-->'] as [string, string]];
  } else if (!cfg.block && doc.languageId !== 'json') {
    effective.block = FALLBACK.block;
  }

  return mergeRanges(scanHeuristic(doc.getText(), doc, effective));
}

// ---------------------------------------------------------------------------
// Stripping — whole-line comments vanish (indent + newline), inline keep code
// ---------------------------------------------------------------------------

function stripWithRanges(doc: vscode.TextDocument, ranges: vscode.Range[]): string {
  const text = doc.getText();
  // Sort descending so removing an earlier range doesn't shift later offsets.
  const flat = ranges
    .map(r => toStrippingOffset(doc, r, text))
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const o of flat) out = out.slice(0, o.start) + out.slice(o.end);
  return out;
}

function toStrippingOffset(doc: vscode.TextDocument, r: vscode.Range, text: string): { start: number; end: number } {
  let start = doc.offsetAt(r.start);
  let end = doc.offsetAt(r.end);
  const before = doc.lineAt(r.start.line).text.slice(0, r.start.character);
  const after = doc.lineAt(r.end.line).text.slice(r.end.character);
  // Whole-line if nothing but whitespace precedes the comment and, when it
  // spans multiple lines, nothing but whitespace follows it.
  const spansMultiple = r.start.line !== r.end.line;
  const wholeLine = before.trim() === '' && (spansMultiple ? after.trim() === '' : true);
  if (wholeLine) {
    start = doc.offsetAt(new vscode.Position(r.start.line, 0));
    if (end < text.length) {
      if (text[end] === '\r' && text[end + 1] === '\n') end += 2;
      else if (text[end] === '\n') end += 1;
    }
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// Semantic tokens (preferred) — asks VS Code's language server for comment ranges
// ---------------------------------------------------------------------------

async function trySemanticTokens(doc: vscode.TextDocument): Promise<vscode.Range[] | null> {
  try {
    const legend: any = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend');
    if (!legend?.tokenTypes) return null;
    const idx = legend.tokenTypes.indexOf('comment');
    if (idx === -1) return null;
    const result: any = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', doc.uri);
    if (!result?.data?.length) return null;
    const data: number[] | Uint32Array = result.data;
    const ranges: vscode.Range[] = [];
    let line = 0, col = 0;
    for (let i = 0; i + 4 < data.length; i += 5) {
      const dl = data[i], dc = data[i + 1], len = data[i + 2], tt = data[i + 3];
      if (dl !== 0) { line += dl; col = dc; } else col += dc;
      if (tt === idx && len > 0) ranges.push(new vscode.Range(new vscode.Position(line, col), new vscode.Position(line, col + len)));
    }
    return ranges;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Heuristic scanner — char-by-char, string-aware, longest-delimiter-first
// ---------------------------------------------------------------------------

function scanHeuristic(text: string, doc: vscode.TextDocument, cfg: LangConfig): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  const lineDelims = [...(cfg.line ?? [])].sort((a, b) => b.length - a.length);
  const blockDelims = [...(cfg.block ?? [])].sort((a, b) => b[0].length - a[0].length);
  const isBat = doc.languageId === 'bat';
  let i = 0, inStr: string | null = null, esc = false, triple: string | null = null;

  while (i < text.length) {
    if (triple) {
      if (text.startsWith(triple, i)) { triple = null; i += 3; continue; }
      i++; continue;
    }
    if (inStr) {
      if (esc) { esc = false; i++; continue; }
      if (text[i] === '\\') { esc = true; i++; continue; }
      if (text[i] === inStr) inStr = null;
      i++; continue;
    }

    // block start?
    let blk: [string, string] | undefined;
    for (const b of blockDelims) if (text.startsWith(b[0], i)) { blk = b; break; }
    if (blk) {
      const s = i, endDelim = blk[1];
      let j = i + blk[0].length, found = -1;
      while (j < text.length) { if (text.startsWith(endDelim, j)) { found = j; break; } j++; }
      if (found !== -1) {
        ranges.push(new vscode.Range(doc.positionAt(s), doc.positionAt(found + endDelim.length)));
        i = found + endDelim.length; continue;
      } else {
        ranges.push(new vscode.Range(doc.positionAt(s), doc.positionAt(text.length))); break;
      }
    }

    // line comment?
    let lineMatch: string | undefined;
    for (const lc of lineDelims) {
      const slice = text.slice(i, i + lc.length);
      const cmp = isBat ? slice.toUpperCase() : slice;
      const tgt = isBat ? lc.toUpperCase() : lc;
      if (cmp === tgt) {
        if (lc === '//' && i > 0 && text[i - 1] === ':') continue; // skip ://
        lineMatch = lc; break;
      }
    }
    if (lineMatch) {
      const s = i; let j = i; while (j < text.length && text[j] !== '\n') j++;
      ranges.push(new vscode.Range(doc.positionAt(s), doc.positionAt(j)));
      i = j; continue;
    }

    // string start?
    const ch = text[i], nxt3 = text.slice(i, i + 3);
    if (ch === '"' || ch === "'" || ch === '`') {
      if ((ch === '"' && nxt3 === '"""') || (ch === "'" && nxt3 === "'''")) {
        const isTripBlock = blockDelims.some(b => b[0] === nxt3.slice(0, 3));
        if (!isTripBlock) { triple = nxt3.slice(0, 3); i += 3; continue; }
      }
      inStr = ch; i++; continue;
    }
    i++;
  }
  return ranges;
}

function mergeRanges(ranges: vscode.Range[]): vscode.Range[] {
  if (!ranges.length) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start.line !== b.start.line ? a.start.line - b.start.line : a.start.character - b.start.character);
  const out: vscode.Range[] = [sorted[0]];
  for (let k = 1; k < sorted.length; k++) {
    const cur = sorted[k], last = out[out.length - 1];
    if (cur.start.isBeforeOrEqual(last.end)) out[out.length - 1] = new vscode.Range(last.start, cur.end.isAfter(last.end) ? cur.end : last.end);
    else out.push(cur);
  }
  return out;
}

import * as vscode from 'vscode';
import { stripComments } from './strip';

const SCHEME = 'commentless';

// ---------------------------------------------------------------------------
// PreviewProvider — virtual documents whose content is the original file
// minus comments. VS Code calls provideTextDocumentContent on open and when
// we fire onDidChange.
// ---------------------------------------------------------------------------
class PreviewProvider implements vscode.TextDocumentContentProvider {
  private didChange = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.didChange.event;

  private previewToOriginal = new Map<string, vscode.Uri>();
  private cache = new Map<string, string>();

  register(preview: vscode.Uri, original: vscode.Uri): void {
    this.previewToOriginal.set(preview.toString(), original);
  }

  refreshFor(original: vscode.Uri): void {
    for (const [previewKey, orig] of this.previewToOriginal) {
      if (orig.toString() === original.toString()) {
        this.cache.delete(previewKey);
        this.didChange.fire(vscode.Uri.parse(previewKey));
      }
    }
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const key = uri.toString();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const original = this.previewToOriginal.get(key);
    if (!original) return '';
    try {
      const doc = await vscode.workspace.openTextDocument(original);
      const stripped = await stripComments(doc);
      this.cache.set(key, stripped);
      return stripped;
    } catch {
      return `// Could not load ${original?.toString()}\n`;
    }
  }

  disposePreview(preview: vscode.Uri): void {
    const key = preview.toString();
    this.previewToOriginal.delete(key);
    this.cache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isPreviewUri(u: vscode.Uri): boolean {
  return u.scheme === SCHEME;
}

function isPreviewDiffTab(tab: vscode.Tab | undefined): boolean {
  if (!tab?.input) return false;
  const inp: any = tab.input;
  return inp instanceof vscode.TabInputTextDiff
    && (inp.original?.scheme === SCHEME || inp.modified?.scheme === SCHEME);
}

function activeDiffUris(): { original: vscode.Uri; modified: vscode.Uri } | null {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab?.input) return null;
  const inp: any = tab.input;
  if (inp instanceof vscode.TabInputTextDiff) return { original: inp.original, modified: inp.modified };
  if (inp.original instanceof vscode.Uri && inp.modified instanceof vscode.Uri) {
    return { original: inp.original, modified: inp.modified };
  }
  return null;
}

function placement(): { viewColumn: vscode.ViewColumn; preview: boolean } {
  const inline = vscode.workspace.getConfiguration('noCommentsPlease').get<boolean>('openPreviewInline', false);
  return inline
    ? { viewColumn: vscode.ViewColumn.Active, preview: false }
    : { viewColumn: vscode.ViewColumn.Beside, preview: true };
}

function updateContext(): void {
  const ed = vscode.window.activeTextEditor;
  const inPreview = ed ? isPreviewUri(ed.document.uri) : false;
  const inDiffPreview = isPreviewDiffTab(vscode.window.tabGroups.activeTabGroup.activeTab);
  void vscode.commands.executeCommand('setContext', 'noCommentsPlease.isPreview', inPreview || inDiffPreview);
}

// ---------------------------------------------------------------------------
// Open flows
// ---------------------------------------------------------------------------
async function openFilePreview(provider: PreviewProvider, uri: vscode.Uri, lang?: string): Promise<void> {
  const previewUri = vscode.Uri.from({
    scheme: SCHEME,
    path: `${uri.path}__preview`,
    query: `orig=${encodeURIComponent(uri.toString())}`,
  });
  provider.register(previewUri, uri);
  const doc = await vscode.workspace.openTextDocument(previewUri);
  if (lang) try { await vscode.languages.setTextDocumentLanguage(doc, lang); } catch { /* ignore */ }
  const { viewColumn, preview } = placement();
  await vscode.window.showTextDocument(doc, { viewColumn, preview, preserveFocus: false });
  updateContext();
}

async function openDiffPreview(provider: PreviewProvider, original: vscode.Uri, modified: vscode.Uri): Promise<void> {
  let lang: string | undefined;
  for (const u of [modified, original]) {
    try { lang = (await vscode.workspace.openTextDocument(u)).languageId; break; } catch { /* try next */ }
  }

  const base = modified.path.split('/').pop() ?? original.path.split('/').pop() ?? 'diff';
  const pOrig = vscode.Uri.from({ scheme: SCHEME, path: `${original.path}__preview`, query: `orig=${encodeURIComponent(original.toString())}` });
  const pMod = vscode.Uri.from({ scheme: SCHEME, path: `${modified.path}__preview`, query: `orig=${encodeURIComponent(modified.toString())}` });

  // Dedup: focus existing preview diff instead of opening a second one.
  for (const g of vscode.window.tabGroups.all) for (const t of g.tabs) {
    const inp: any = (t.input as any);
    if (inp instanceof vscode.TabInputTextDiff
      && inp.original?.toString() === pOrig.toString()
      && inp.modified?.toString() === pMod.toString()) {
      await vscode.commands.executeCommand('vscode.diff', pOrig, pMod, `${base} — Without Comments`);
      return;
    }
  }

  provider.register(pOrig, original);
  provider.register(pMod, modified);
  const [d1, d2] = await Promise.all([
    vscode.workspace.openTextDocument(pOrig),
    vscode.workspace.openTextDocument(pMod),
  ]);
  if (lang) {
    for (const d of [d1, d2]) try { await vscode.languages.setTextDocumentLanguage(d, lang); } catch { /* ignore */ }
  }
  const title = `${base} — Without Comments`;
  const { viewColumn, preview } = placement();
  try {
    await vscode.commands.executeCommand('vscode.diff', pOrig, pMod, title, { viewColumn, preview, preserveFocus: false } as any);
  } catch {
    await vscode.commands.executeCommand('vscode.diff', pOrig, pMod, title);
  }
  updateContext();
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------
export function activate(ctx: vscode.ExtensionContext): void {
  const provider = new PreviewProvider();

  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.window.onDidChangeActiveTextEditor(updateContext),
    vscode.window.tabGroups.onDidChangeTabs(updateContext),
    vscode.workspace.onDidChangeTextDocument(e => provider.refreshFor(e.document.uri)),
    vscode.workspace.onDidCloseTextDocument(d => {
      if (isPreviewUri(d.uri)) provider.disposePreview(d.uri);
    }),
  );
  updateContext();

  ctx.subscriptions.push(
    vscode.commands.registerCommand('no-comments-please.toggle', async (clickedUri?: vscode.Uri) => {
      const diff = activeDiffUris();
      if (diff && diff.original.scheme !== SCHEME && diff.modified.scheme !== SCHEME) {
        await openDiffPreview(provider, diff.original, diff.modified);
        return;
      }

      let uri: vscode.Uri | undefined;
      let lang: string | undefined;
      if (clickedUri) {
        uri = clickedUri;
        try { lang = (await vscode.workspace.openTextDocument(uri)).languageId; } catch { /* ignore */ }
      } else {
        const ed = vscode.window.activeTextEditor;
        if (!ed || isPreviewUri(ed.document.uri)) return;
        uri = ed.document.uri;
        lang = ed.document.languageId;
      }
      if (!uri || isPreviewUri(uri)) return;

      if (lang && new Set(['markdown', 'plaintext', 'log', 'scminput']).has(lang)) {
        const pick = await vscode.window.showWarningMessage(
          `"${lang}" is not a programming language. Preview anyway?`, 'Preview anyway', 'Cancel');
        if (pick !== 'Preview anyway') return;
      }
      await openFilePreview(provider, uri, lang);
    }),

    vscode.commands.registerCommand('no-comments-please.showWithComments', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (isPreviewDiffTab(tab)) {
        await vscode.window.tabGroups.close(tab as vscode.Tab);
        updateContext();
        return;
      }
      const ed = vscode.window.activeTextEditor;
      if (ed && isPreviewUri(ed.document.uri)) {
        const t = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (t) await vscode.window.tabGroups.close(t);
        updateContext();
      }
    }),
  );
}

export function deactivate(): void {}

# No Comments Please

[![Version](https://img.shields.io/badge/version-0.1.0-6d5dfc)](https://github.com/mliptak0/no-comments-please)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-46ecd5.svg)](LICENSE)

**Preview any code file *or Git diff* without comments — original untouched, preview has zero gaps.**

Like Markdown Preview for comments. One toggle, any language.

## Features

- **Original never edited** — a virtual `commentless://` tab shows the same file with comments stripped.
- **Zero gaps** — whole-line comments vanish (indent + newline removed); inline `code // comment` keeps the code.
- **Diff-aware** — `diff → preview diff beside` strips both sides; the diff shows only code changes.
- **40+ languages** — semantic tokens + heuristic fallback via `LANGUAGE_CONFIG`.

## Usage

| Action | How |
|---|---|
| **Toggle preview** | Eye icon in the editor title bar, right-click menu (editor or Explorer), Command Palette, or `Cmd+Alt+.` / `Ctrl+Alt+.` |
| **Files** | File → preview beside (or same row if `openPreviewInline` enabled) |
| **Diffs** | Diff → preview diff beside — both sides stripped |
| **Close preview** | Toggle again (eye-closed icon on preview) |

Supported languages: JS/TS/JSX/TSX, Python, Java, C/C++/C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Dart, Scala, Groovy, CoffeeScript, CSS/SCSS/Less, HTML/XML, Vue/Svelte/Astro, Shell, PowerShell, YAML, Dockerfile, Makefile, SQL, Lua, R, Perl, Haskell, Elixir, Erlang, Clojure, TOML, INI, Batch, LaTeX, and more (fallback for unknown).

## Notes

- Toggling Markdown, plain text, or log files asks for confirmation first (there are no comments to strip).
- Comment detection prefers the language server's semantic tokens and falls back to a delimiter scan. The fallback is not a full parser — for example, a regex literal containing `//` can be misread as a comment in the preview. The original file is never modified.

## Settings

| Setting | Default | Description |
|---|---|---|
| `noCommentsPlease.openPreviewInline` | `false` | Open preview next to the file tab in the same row (same editor group). When disabled, preview opens in a separate editor group to the side. |

## Installation

From the Marketplace (once published):

```sh
code --install-extension no-comments-please.no-comments-please
codium --install-extension no-comments-please.no-comments-please
```

From VSIX:

```sh
code --install-extension no-comments-please-0.1.0.vsix
codium --install-extension no-comments-please-0.1.0.vsix
```

## Development

```sh
npm install
npm run compile        # build to out/
npm run watch          # watch mode
# F5 → Extension Host → toggle on a file or diff
npx @vscode/vsce package --no-dependencies   # build vsix
npx @vscode/vsce ls --no-dependencies        # list packaged files
```

## License

[MIT](LICENSE) — icon: cartoon ghost by No Comments Please.

# Node 0 Spike Results

## Stack

- Desktop shell: Tauri 2
- Frontend: Vite + React + TypeScript
- UI: shadcn/ui + Tailwind CSS
- Editor spike: Monaco Editor, lazy-loaded
- Terminal spike: xterm.js, lazy-loaded
- Core: Rust commands through Tauri IPC

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Cold launch to visible shell | 391 ms | under 2000 ms |
| Idle memory after shell load | 125 MB | under 180 MB |
| Memory delta after Monaco load | 57 MB | measured and acceptable |
| Memory delta after xterm.js load | 20 MB | measured and acceptable |
| Memory with one workspace registered | 125 MB | under 180 MB |
| Memory with three workspaces registered | 125 MB | under 300 MB |
| Terminal startup latency | 61 ms | under 300 ms |
| File tree scan latency | 1 ms | under 100 ms for small project |
| Main WebView count while switching workspaces | 1 | exactly 1 |

## Measurement Notes

Launch, idle RSS, one-workspace RSS, three-workspace RSS, and WebContent count
were measured against the Tauri debug app. The launch check used
`open -na .../Yuuzu-IDE.app` and measured from process launch to a
CoreGraphics-visible Yuuzu-IDE window with a temporary `/tmp/has-yuuzu-window`
helper. The stabilized RSS total included the Yuuzu debug app process plus the
app-started WebKit GPU, Networking, and WebContent processes: main 85,120 KB,
GPU 17,440 KB, Networking 7,488 KB, and WebContent 19,824 KB, rounded to
125 MB.

Monaco and xterm.js memory deltas were measured with a Playwright Chromium
production preview process tree because local desktop automation could observe
the offscreen Tauri window and processes but could not interact with WebView
content. Terminal startup latency came from a temporary Rust `portable-pty
0.9.0` probe with seven samples `[55, 56, 60, 61, 63, 63, 66]`, giving a
61 ms median. File tree scan latency came from a temporary Rust top-level scan
equivalent to the Node 0 scan scope over this repo; the median was 0.150 ms for
19 entries and was rounded up to 1 ms for the table.

## Result

The Tauri 2 + React route remains the primary implementation path because the
measured results stay within the Node 0 pass targets.

## Follow-Up Decisions

- Keep browser preview outside the app until Node 8.
- Keep Monaco and xterm lazy-loaded.
- Keep Rust as owner of workspace state, PTY, search, git, and LSP lifecycle.

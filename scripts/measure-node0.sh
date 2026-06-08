#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/measure-node0.sh

Builds the Node 0 debug app and prints process guidance for manual memory checks.
EOF
  exit 0
fi

bun run build
bun run tauri build --debug

cat <<'EOF'
Manual measurement checklist:
1. Launch the debug app from src-tauri/target/debug/.
2. Record cold launch time to visible shell.
3. Record idle memory after shell load.
4. Open the editor tab and record Monaco memory delta.
5. Open the terminal tab and record xterm/PTX memory delta.
6. Confirm workspace switching does not create one WebView per workspace.

macOS process commands:
  ps -axo pid,ppid,rss,comm | rg 'yuuzu|WebView|Yuuzu'

Windows process commands:
  Get-Process | Where-Object { $_.ProcessName -match 'yuuzu|msedgewebview2' } |
    Select-Object ProcessName,Id,WorkingSet64
EOF

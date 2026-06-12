# Extension API Draft

Status: Node 12 draft, manifest-only execution boundary.

## Goals

- Let internal Yuuzu-IDE features and future external extensions describe commands through the same registry shape.
- Allow extensions to be disabled per workspace.
- Make slow extensions visible before a full extension host exists.

## Non-Goals

- Marketplace.
- Arbitrary code execution.
- Network-capable extension host.
- Unbounded filesystem or process access.

## Manifest

Node 12 reads manifest contributions as data. The manifest is the execution
boundary: it can describe commands, themes, keybindings, snippets, and workspace
hooks, but it cannot execute extension-owned code.

```json
{
  "id": "yuuzu.debug-tools",
  "name": "Yuuzu Debug Tools",
  "version": "0.1.0",
  "api_version": "0.1",
  "description": "Debugging helpers exposed through manifest-only extension contributions.",
  "builtin": true,
  "contributes": {
    "commands": [
      {
        "id": "yuuzu.debug-tools.inspect-session",
        "label": "Inspect Debug Session",
        "group": "Debug",
        "description": "Open trusted core debug session inspection.",
        "owner_extension_id": "yuuzu.debug-tools"
      }
    ],
    "themes": [
      {
        "id": "yuuzu-dark",
        "label": "Yuuzu Dark",
        "mode": "dark",
        "accent": "#7c3aed"
      }
    ],
    "keybindings": [
      {
        "command": "open-command-palette",
        "key": "Mod+Shift+P",
        "when": "workspaceOpen"
      }
    ],
    "snippets": [
      {
        "id": "debug-log",
        "language": "typescript",
        "prefix": "dbg",
        "body": [
          "console.debug($1);"
        ],
        "description": "Insert a debug log statement."
      }
    ],
    "workspace_hooks": [
      {
        "id": "inspect-session-on-open",
        "event": "WorkspaceOpened",
        "command": "yuuzu.debug-tools.inspect-session",
        "budget_ms": 75
      }
    ]
  }
}
```

## Command Registry

Extension commands use the same command contribution record shape as trusted
internal Yuuzu-IDE features.

```ts
type ExtensionCommandContribution = {
  id: string;
  label: string;
  group: string;
  description: string;
  owner_extension_id: string;
};
```

Disabled workspace extensions are filtered before the command palette renders.
Node 12 extension commands do not run arbitrary extension host code; selecting
one records a bounded performance sample.

## Workspace Disablement

Workspace disablement is scoped by canonical workspace root and extension id.
The enabled flag stores the effective workspace-level state for that extension.

```json
{
  "workspace_root": "/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide",
  "extension_id": "yuuzu.debug-tools",
  "enabled": false
}
```

## Isolation Model

- Node 12 accepts manifest contributions only.
- Extension commands are inert contribution records unless implemented by trusted core code.
- Workspace hooks are inert contribution records in Node 12.
- No extension may access filesystem, process, terminal, network, secrets, or database APIs directly.
- Future host work must pass capabilities explicitly and record performance samples.

## Performance Budget

Default warning budgets:

- activation: 200 ms
- command: 50 ms
- workspace hook: 75 ms

Performance samples use this record shape:

```ts
type ExtensionPerformanceSample = {
  extension_id: string;
  workspace_root: string;
  operation: string;
  duration_ms: number;
  budget_ms: number;
  recorded_ms: number;
};
```

Current command samples use `command:<command-id>` in the `operation` field.
The Extensions panel marks an extension as Slow when it has at least one slow
operation in the current workspace.

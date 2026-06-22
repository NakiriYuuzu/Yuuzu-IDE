# Regression Test Patterns

## Existing tests to imitate

| Behavior | Preferred test home |
| --- | --- |
| File tree, workspace event handling, Git reload scheduling | `src/v2/folder-expand.test.ts` |
| V2 state and demo delegate actions | `src/v2/v2-store.test.ts` |
| Pure data mapping between backend payloads and v2 models | `src/v2/bridge.test.ts` |
| Editor/browser content views and tab rendering | `src/v2/ContentViews.test.tsx` |
| CodeMirror extensions, completions, syntax, and editor surface contracts | `src/v2/editor/editor-surface.test.ts` |
| CSS/theme/model contracts | `src/v2/v2-model.test.ts` |
| Settings, context menus, confirmations, and overlays | `src/v2/Overlays.test.tsx` |
| Agent zone layout/session behavior | `src/v2/AgentZone.test.tsx` |
| Rust commands and workspace safety | Inline tests in `src-tauri/src/<domain>.rs` |

## Frontend pattern

1. Import the existing test helpers from the adjacent test file instead of creating new harnesses.
2. Mock delegates at the real boundary used by `controller.ts` or the store.
3. Assert on user-visible state, delegate calls, or command arguments, not implementation details.
4. Use `await` and fake timers only where the existing file already uses them.
5. Keep assertions specific enough to fail on the original bug.

## Rust pattern

1. Put tests in the domain module that owns the logic.
2. Use temp dirs and registered workspace roots for filesystem behavior.
3. Exercise both success and boundary rejection when the command touches paths.
4. Run a focused Cargo filter first:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml <test_name_or_module>
```

## Examples

Git watcher regression:

- Arrange an active workspace and loaded Git Graph state.
- Emit an external file event for a path under `.git/`.
- Assert no Git reload is scheduled and visible commit detail state is preserved.

Dark theme caret regression:

- Add or update a CSS/model contract that requires CodeMirror caret color to use a visible theme token.
- Pair with editor surface tests if the bug involves focus, editor instance lifetime, or content updates.
- Runtime smoke is still needed for the final visual claim.

Create/delete Explorer regression:

- Store/controller test: prompt/confirm flow, command delegate call, tree refresh, Git reload scheduling.
- Rust test: workspace boundary, safe name/path validation, real filesystem side effect.

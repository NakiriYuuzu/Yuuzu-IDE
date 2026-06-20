# Terminal Atomic Resize and Image Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize Yuuzu-IDE's integrated xterm for Claude Code style full-screen TUIs by synchronizing visual fit and PTY resize in one frame, then add inline image support for SIXEL and iTerm image protocol through the xterm image addon.

**Architecture:** Keep Rust PTY resize as-is because `src-tauri/src/terminal.rs` already owns kernel PTY resizing and has coverage for `resize_session_updates_kernel_pty_size`. Fix the frontend timing gap in `TerminalTab.tsx`: compute proposed dimensions, fit xterm, and notify the backend in the same animation-frame callback, sending only changed dimensions. Add `@xterm/addon-image` in the existing lazy xterm loader so the dependency stays outside initial app startup and all `TerminalTab` consumers share the same terminal capabilities.

**Tech Stack:** Tauri 2, Rust `portable-pty`, React 19, Vite 8, Bun tests, xterm.js 6.0, `@xterm/addon-fit`, `@xterm/addon-image`.

---

## Context

This plan continues from `2026-06-16-011359-ide-terminals-ui.txt`.

The current diagnosis:

- Claude Code TUI output inside Yuuzu-IDE can visually corrupt because xterm's visible size changes immediately while the PTY size notification is delayed by `RESIZE_NOTIFY_DEBOUNCE_MS = 100`.
- `src/features/terminal/TerminalTab.tsx` currently calls `fitAddon.fit()` inside `ResizeObserver`, then delays `notifyPtySize()` with `setTimeout`.
- Rust resize is not the primary fault: `TerminalState::resize_session()` calls `master.resize(terminal_size(rows, cols))`, and the Rust unit test proves the kernel PTY size changes.
- The previous terminal stability work deliberately removed React render from terminal output. Keep that design: terminal chunks must continue to go through `terminal-replay-buffer.ts` and direct `terminal.write()`.
- The existing uncommitted `Shift+Enter` behavior in `TerminalTab.tsx` must be preserved.
- Kitty graphics protocol is not part of this implementation plan. Do not set `TERM=kitty` and do not claim Kitty support. This plan adds SIXEL and iTerm inline image support only, using the current npm package `@xterm/addon-image` version `0.9.0` as checked with `bun pm view @xterm/addon-image version` on 2026-06-17.

## Scope Check

This is one plan because both changes are in the same terminal rendering boundary:

- Task 1 makes terminal dimensions stable for full-screen TUI redraws.
- Task 2 adds image protocol rendering to the same xterm instance.
- Task 3 verifies the combined terminal behavior in unit tests, build, Rust PTY resize test, and Tauri runtime.

Do not expand this into a full custom Kitty graphics parser. If a CLI emits Kitty-only graphics after this plan, Yuuzu-IDE may still show a fallback such as "Try a terminal with Kitty graphics or Sixel support"; the expected improvement is that SIXEL/iTerm-capable programs can render images.

## File Structure

- Modify `src/features/terminal/TerminalTab.tsx`
  - Owns xterm instance creation, output subscription, keyboard event bridge, terminal fit, PTY resize notification, and addon loading.
  - Keep this component as the single terminal runtime boundary used by content tabs, AgentZone, and SSH surfaces.

- Modify `src/features/terminal/TerminalTab.test.ts`
  - Extends the current mocked xterm tests.
  - Adds animation-frame-controlled resize tests.
  - Adds image addon loading assertions.

- Modify `src/features/terminal/load-xterm.ts`
  - Lazy-loads `@xterm/addon-image` next to xterm core, fit addon, and xterm CSS.

- Modify `package.json`
  - Adds `@xterm/addon-image`.

- Modify `bun.lock`
  - Produced by `bun add @xterm/addon-image@^0.9.0`.

- Read-only verification references:
  - `src-tauri/src/terminal.rs`
  - `src/v2/ContentViews.tsx`
  - `src/v2/AgentZone.tsx`
  - `src/features/remote/SshTerminalSurface.tsx`

## Task 1: Atomic Terminal Fit and PTY Resize

**Files:**

- Modify: `src/features/terminal/TerminalTab.test.ts`
- Modify: `src/features/terminal/TerminalTab.tsx`

- [ ] **Step 1: Add animation-frame control helpers to `TerminalTab.test.ts`**

Insert this helper block after `waitUntil()` in `src/features/terminal/TerminalTab.test.ts`:

```ts
function installAnimationFrameMock() {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((frameId: number) => {
    callbacks.delete(frameId);
  }) as typeof cancelAnimationFrame;

  return {
    pendingCount: () => callbacks.size,
    flush: () => {
      const queuedCallbacks = [...callbacks.values()];
      callbacks.clear();
      queuedCallbacks.forEach((callback) => callback(0));
    },
    restore: () => {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
}
```

- [ ] **Step 2: Extend fake xterm classes in `TerminalTab.test.ts`**

Replace the existing `FakeTerminal` and `FakeFitAddon` classes with this code:

```ts
class FakeTerminal {
  static instances: FakeTerminal[] = [];
  options: Record<string, unknown>;
  addons: unknown[] = [];
  writes: string[] = [];
  clearCalls = 0;
  keyHandler: ((event: KeyboardEvent) => boolean) | undefined;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeTerminal.instances.push(this);
  }

  loadAddon(addon: unknown) {
    this.addons.push(addon);
  }
  open() {}
  write(data: string) {
    this.writes.push(data);
  }
  clear() {
    this.clearCalls += 1;
  }
  dispose() {}
  onData() {
    return { dispose: () => {} };
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.keyHandler = handler;
  }
}

class FakeFitAddon {
  static instances: FakeFitAddon[] = [];
  static proposed: { rows: number; cols: number } | undefined = {
    rows: 30,
    cols: 100,
  };
  fitCalls = 0;

  constructor() {
    FakeFitAddon.instances.push(this);
  }

  fit() {
    this.fitCalls += 1;
  }
  proposeDimensions() {
    return FakeFitAddon.proposed;
  }
}
```

- [ ] **Step 3: Reset fake addon state in the existing tests**

For every test in `TerminalTab.test.ts` that currently starts with `FakeTerminal.instances = [];`, add this line immediately after it:

```ts
FakeFitAddon.instances = [];
```

The first test should start like this after the edit:

```ts
test("replays buffered output once on mount and writes live chunks directly", async () => {
  FakeTerminal.instances = [];
  FakeFitAddon.instances = [];
  loadXtermMock.mockResolvedValueOnce(fakeXterm());
  clearTerminalReplayOutput("w:tab-1");
  appendTerminalReplayOutput("w:tab-1", "boot\n");
```

- [ ] **Step 4: Replace the debounce resize test with an animation-frame resize test**

Replace the current test named `"debounces resize notifications after container resizes"` in `src/features/terminal/TerminalTab.test.ts` with this test:

```ts
test("coalesces resize observer ticks and syncs the PTY in the animation frame", async () => {
  const raf = installAnimationFrameMock();
  FakeTerminal.instances = [];
  FakeFitAddon.instances = [];
  ControlledResizeObserver.instances = [];
  FakeFitAddon.proposed = { rows: 30, cols: 100 };
  loadXtermMock.mockResolvedValueOnce(fakeXterm());
  clearTerminalReplayOutput("w:tab-7");
  const resizeCalls: Array<[string, number, number]> = [];

  const mounted = await mountTerminalTab("w:tab-7", (sessionId, rows, cols) =>
    resizeCalls.push([sessionId, rows, cols]),
  );
  await waitUntil(() =>
    expect(ControlledResizeObserver.instances.length).toBe(1),
  );
  const observer = ControlledResizeObserver.instances[0]!;
  const fitAddon = FakeFitAddon.instances[0]!;
  resizeCalls.length = 0;

  FakeFitAddon.proposed = { rows: 48, cols: 180 };
  observer.trigger();
  observer.trigger();

  expect(resizeCalls).toEqual([]);
  expect(raf.pendingCount()).toBe(1);

  raf.flush();

  expect(resizeCalls).toEqual([["w:tab-7", 48, 180]]);
  expect(fitAddon.fitCalls).toBe(2);

  mounted.unmount();
  raf.restore();
  clearTerminalReplayOutput("w:tab-7");
  loadXtermMock.mockReset();
});
```

- [ ] **Step 5: Add duplicate-dimension suppression coverage**

Add this test after the animation-frame resize test:

```ts
test("does not notify the PTY again when fitted dimensions are unchanged", async () => {
  const raf = installAnimationFrameMock();
  FakeTerminal.instances = [];
  FakeFitAddon.instances = [];
  ControlledResizeObserver.instances = [];
  FakeFitAddon.proposed = { rows: 30, cols: 100 };
  loadXtermMock.mockResolvedValueOnce(fakeXterm());
  clearTerminalReplayOutput("w:tab-10");
  const resizeCalls: Array<[string, number, number]> = [];

  const mounted = await mountTerminalTab("w:tab-10", (sessionId, rows, cols) =>
    resizeCalls.push([sessionId, rows, cols]),
  );
  await waitUntil(() =>
    expect(ControlledResizeObserver.instances.length).toBe(1),
  );
  const observer = ControlledResizeObserver.instances[0]!;
  resizeCalls.length = 0;

  observer.trigger();
  raf.flush();

  expect(resizeCalls).toEqual([]);

  mounted.unmount();
  raf.restore();
  clearTerminalReplayOutput("w:tab-10");
  loadXtermMock.mockReset();
});
```

- [ ] **Step 6: Add unmount cancellation coverage**

Add this test after the duplicate-dimension test:

```ts
test("cancels pending terminal resize frames on unmount", async () => {
  const raf = installAnimationFrameMock();
  FakeTerminal.instances = [];
  FakeFitAddon.instances = [];
  ControlledResizeObserver.instances = [];
  FakeFitAddon.proposed = { rows: 30, cols: 100 };
  loadXtermMock.mockResolvedValueOnce(fakeXterm());
  clearTerminalReplayOutput("w:tab-11");
  const resizeCalls: Array<[string, number, number]> = [];

  const mounted = await mountTerminalTab("w:tab-11", (sessionId, rows, cols) =>
    resizeCalls.push([sessionId, rows, cols]),
  );
  await waitUntil(() =>
    expect(ControlledResizeObserver.instances.length).toBe(1),
  );
  const observer = ControlledResizeObserver.instances[0]!;
  resizeCalls.length = 0;

  FakeFitAddon.proposed = { rows: 50, cols: 200 };
  observer.trigger();
  expect(raf.pendingCount()).toBe(1);

  mounted.unmount();
  raf.flush();

  expect(resizeCalls).toEqual([]);

  raf.restore();
  clearTerminalReplayOutput("w:tab-11");
  loadXtermMock.mockReset();
});
```

- [ ] **Step 7: Run the terminal tests and verify the new resize test fails**

Run:

```bash
bun test src/features/terminal/TerminalTab.test.ts
```

Expected: FAIL. The new animation-frame test must fail because current `TerminalTab.tsx` uses `setTimeout`, so `raf.pendingCount()` is `0` instead of `1`.

- [ ] **Step 8: Add dimension helpers to `TerminalTab.tsx`**

Replace `const RESIZE_NOTIFY_DEBOUNCE_MS = 100;` in `src/features/terminal/TerminalTab.tsx` with this code:

```ts
type TerminalDimensions = {
  rows: number;
  cols: number;
};

function normalizeTerminalDimensions(
  dimensions: TerminalDimensions | undefined,
): TerminalDimensions | null {
  if (!dimensions) return null;
  const rows = Math.floor(dimensions.rows);
  const cols = Math.floor(dimensions.cols);
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return null;
  return {
    rows: Math.max(1, rows),
    cols: Math.max(1, cols),
  };
}

function sameTerminalDimensions(
  left: TerminalDimensions | null,
  right: TerminalDimensions,
): boolean {
  return left?.rows === right.rows && left.cols === right.cols;
}
```

- [ ] **Step 9: Replace delayed resize notification in `TerminalTab.tsx`**

Inside the `useEffect` body in `src/features/terminal/TerminalTab.tsx`, replace:

```ts
let resizeNotifyTimer: ReturnType<typeof setTimeout> | undefined;
```

with:

```ts
let lastSentDimensions: TerminalDimensions | null = null;
let resizeFrame: number | undefined;
```

Then replace the existing `notifyPtySize()` and `ResizeObserver` block:

```ts
const notifyPtySize = () => {
  const dimensions = fitAddon.proposeDimensions();
  if (dimensions) {
    onResizeRef.current?.(sessionId, dimensions.rows, dimensions.cols);
  }
};
notifyPtySize();

const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  if (resizeNotifyTimer !== undefined) {
    clearTimeout(resizeNotifyTimer);
  }
  resizeNotifyTimer = setTimeout(notifyPtySize, RESIZE_NOTIFY_DEBOUNCE_MS);
});
resizeObserver.observe(hostRef.current);
cleanup = createTerminalCleanup(terminal, resizeObserver);
```

with:

```ts
const syncTerminalSize = () => {
  const dimensions = normalizeTerminalDimensions(fitAddon.proposeDimensions());
  if (!dimensions) return;

  fitAddon.fit();

  if (sameTerminalDimensions(lastSentDimensions, dimensions)) return;
  lastSentDimensions = dimensions;
  onResizeRef.current?.(sessionId, dimensions.rows, dimensions.cols);
};

const scheduleTerminalSizeSync = () => {
  if (resizeFrame !== undefined) return;
  const requestFrame =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback: FrameRequestCallback) =>
          Number(setTimeout(() => callback(Date.now()), 0));
  resizeFrame = requestFrame(() => {
    resizeFrame = undefined;
    syncTerminalSize();
  });
};

syncTerminalSize();

const resizeObserver = new ResizeObserver(() => {
  scheduleTerminalSizeSync();
});
resizeObserver.observe(hostRef.current);
cleanup = createTerminalCleanup(terminal, resizeObserver);
```

- [ ] **Step 10: Replace timer cleanup with frame cleanup in `TerminalTab.tsx`**

In the cleanup function in `src/features/terminal/TerminalTab.tsx`, replace:

```ts
if (resizeNotifyTimer !== undefined) {
  clearTimeout(resizeNotifyTimer);
}
```

with:

```ts
if (resizeFrame !== undefined) {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(resizeFrame);
  } else {
    clearTimeout(resizeFrame);
  }
}
```

- [ ] **Step 11: Run terminal tests and verify Task 1 passes**

Run:

```bash
bun test src/features/terminal/TerminalTab.test.ts
```

Expected: PASS. All tests in `TerminalTab.test.ts` pass, including the new resize coalescing, duplicate suppression, and unmount cancellation tests.

- [ ] **Step 12: Commit Task 1**

Run:

```bash
git add src/features/terminal/TerminalTab.tsx src/features/terminal/TerminalTab.test.ts
git commit -m "fix: sync terminal fit and pty resize atomically"
```

Expected: commit succeeds and includes only the two terminal files touched in Task 1. If the worktree contains unrelated user changes, stage only the two paths shown above.

## Task 2: Add SIXEL and iTerm Image Addon Support

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/features/terminal/load-xterm.ts`
- Modify: `src/features/terminal/TerminalTab.tsx`
- Modify: `src/features/terminal/TerminalTab.test.ts`

- [ ] **Step 1: Add a fake image addon to `TerminalTab.test.ts`**

Insert this class after `FakeFitAddon`:

```ts
class FakeImageAddon {
  static instances: FakeImageAddon[] = [];
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeImageAddon.instances.push(this);
  }
}
```

Then replace `fakeXterm()` with:

```ts
function fakeXterm() {
  return {
    Terminal: FakeTerminal,
    FitAddon: FakeFitAddon,
    ImageAddon: FakeImageAddon,
  };
}
```

- [ ] **Step 2: Reset fake image addon state in each terminal test**

For every test in `TerminalTab.test.ts` that resets `FakeFitAddon.instances`, add this line immediately after it:

```ts
FakeImageAddon.instances = [];
```

The first test should start like this after the edit:

```ts
test("replays buffered output once on mount and writes live chunks directly", async () => {
  FakeTerminal.instances = [];
  FakeFitAddon.instances = [];
  FakeImageAddon.instances = [];
  loadXtermMock.mockResolvedValueOnce(fakeXterm());
  clearTerminalReplayOutput("w:tab-1");
  appendTerminalReplayOutput("w:tab-1", "boot\n");
```

- [ ] **Step 3: Add image addon loading coverage**

Add this test before `"stops writing chunks after unmount"`:

```ts
test("loads image support before opening the terminal", async () => {
  FakeTerminal.instances = [];
  FakeFitAddon.instances = [];
  FakeImageAddon.instances = [];
  loadXtermMock.mockResolvedValueOnce(fakeXterm());
  clearTerminalReplayOutput("w:tab-12");

  const mounted = await mountTerminalTab("w:tab-12");
  await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

  const terminal = FakeTerminal.instances[0]!;
  expect(terminal.options.allowProposedApi).toBe(true);
  expect(FakeImageAddon.instances).toHaveLength(1);
  expect(FakeImageAddon.instances[0]!.options).toEqual({
    enableSizeReports: true,
    pixelLimit: 16_777_216,
    sixelSupport: true,
    sixelScrolling: true,
    sixelPaletteLimit: 256,
    storageLimit: 128,
  });
  expect(terminal.addons[0]).toBe(FakeImageAddon.instances[0]);
  expect(terminal.addons).toContain(FakeFitAddon.instances[0]);

  mounted.unmount();
  clearTerminalReplayOutput("w:tab-12");
  loadXtermMock.mockReset();
});
```

- [ ] **Step 4: Run the terminal test and verify image support test fails**

Run:

```bash
bun test src/features/terminal/TerminalTab.test.ts
```

Expected: FAIL. The new image support test must fail because current `TerminalTab.tsx` does not set `allowProposedApi` and does not construct or load `ImageAddon`.

- [ ] **Step 5: Install the xterm image addon**

Run:

```bash
bun add @xterm/addon-image@^0.9.0
```

Expected:

- `package.json` gains `"@xterm/addon-image": "^0.9.0"` under dependencies.
- `bun.lock` gains the resolved addon entry.

- [ ] **Step 6: Update `load-xterm.ts` to lazy-load the image addon**

Replace the entire contents of `src/features/terminal/load-xterm.ts` with:

```ts
export async function loadXterm() {
  const [{ Terminal }, { FitAddon }, { ImageAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-image"),
    import("@xterm/xterm/css/xterm.css"),
  ]);

  return { Terminal, FitAddon, ImageAddon };
}
```

- [ ] **Step 7: Load the image addon from `TerminalTab.tsx`**

In `src/features/terminal/TerminalTab.tsx`, replace:

```ts
const { Terminal, FitAddon } = await loadXterm();
```

with:

```ts
const { Terminal, FitAddon, ImageAddon } = await loadXterm();
```

Then replace the `new Terminal(...)` options block:

```ts
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  theme: {
    background: "#0a0e15",
    foreground: "#e6edf3",
    cursor: "#a8e23f",
    selectionBackground: "#34421d",
  },
});
const fitAddon = new FitAddon();

terminal.loadAddon(fitAddon);
terminal.open(hostRef.current);
fitAddon.fit();
```

with:

```ts
const terminal = new Terminal({
  allowProposedApi: true,
  cursorBlink: true,
  fontSize: 13,
  theme: {
    background: "#0a0e15",
    foreground: "#e6edf3",
    cursor: "#a8e23f",
    selectionBackground: "#34421d",
  },
});
const imageAddon = new ImageAddon({
  enableSizeReports: true,
  pixelLimit: 16_777_216,
  sixelSupport: true,
  sixelScrolling: true,
  sixelPaletteLimit: 256,
  storageLimit: 128,
});
const fitAddon = new FitAddon();

terminal.loadAddon(imageAddon);
terminal.loadAddon(fitAddon);
terminal.open(hostRef.current);
fitAddon.fit();
```

- [ ] **Step 8: Run terminal tests and verify Task 2 passes**

Run:

```bash
bun test src/features/terminal/TerminalTab.test.ts
```

Expected: PASS. The image support test passes and the earlier output, resize, and `Shift+Enter` tests remain green.

- [ ] **Step 9: Run the TypeScript/Vite build**

Run:

```bash
bun run build
```

Expected: PASS. The build may print the existing Vite chunk-size warning for Monaco/xterm assets, but the command exits with code `0`.

- [ ] **Step 10: Commit Task 2**

Run:

```bash
git add package.json bun.lock src/features/terminal/load-xterm.ts src/features/terminal/TerminalTab.tsx src/features/terminal/TerminalTab.test.ts
git commit -m "feat: enable terminal sixel image support"
```

Expected: commit succeeds and includes only the package, loader, terminal component, and terminal test changes from Task 2.

## Task 3: Runtime Verification for TUI Stability and Image Rendering

**Files:**

- Read: `src-tauri/src/terminal.rs`
- Read: `src/v2/ContentViews.tsx`
- Read: `src/v2/AgentZone.tsx`
- Read: `src/features/remote/SshTerminalSurface.tsx`

- [ ] **Step 1: Re-run focused frontend terminal tests**

Run:

```bash
bun test src/features/terminal/TerminalTab.test.ts
```

Expected: PASS.

- [ ] **Step 2: Re-run Rust PTY resize proof**

Run:

```bash
cargo test resize_session_updates_kernel_pty_size --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. The output includes:

```text
test terminal::tests::resize_session_updates_kernel_pty_size ... ok
```

- [ ] **Step 3: Run the app build**

Run:

```bash
bun run build
```

Expected: PASS with exit code `0`.

- [ ] **Step 4: Start Tauri dev runtime**

Run:

```bash
bun run tauri dev
```

Expected: Yuuzu-IDE opens. Keep the process running during the next steps. If port `1420` is busy, Vite/Tauri selects the configured available dev URL according to the existing repo config.

- [ ] **Step 5: Verify PTY dimensions track the visible terminal**

In a Yuuzu-IDE integrated terminal, run:

```bash
while true; do printf '\rcols=%s rows=%s    ' "$(tput cols)" "$(tput lines)"; sleep 0.2; done
```

Resize the Yuuzu-IDE window and switch AgentZone between Auto / 2 / 3 / 4 columns.

Expected:

- `cols` and `rows` update after the visible terminal size changes.
- The text line does not visually overlap itself while resizing.
- Press `Ctrl-C` to stop the loop.

- [ ] **Step 6: Verify a simple SIXEL image renders**

In a Yuuzu-IDE integrated terminal, run:

```bash
printf '\033Pq#0;2;100;0;0!60~-!60~\033\\\n'
```

Expected:

- A red SIXEL rectangle is rendered in the terminal area.
- Raw escape text is not printed as visible terminal text.
- If no image appears, open DevTools and inspect the terminal DOM for `.xterm-image-layer`; if the canvas exists but has no visible pixels, stop implementation and report that `@xterm/addon-image` is not rendering on the current xterm/runtime combination.

- [ ] **Step 7: Verify Claude Code TUI no longer corrupts during redraw**

In a Yuuzu-IDE integrated terminal, run:

```bash
claude
```

Then submit a prompt that causes active streaming status updates, for example:

```text
Think for 20 seconds and print a short status line every few seconds before answering.
```

Expected:

- Dynamic status lines do not overlap stale text.
- `attempt`, `tokens`, and thinking/status text stay on coherent terminal rows.
- Resizing the Yuuzu-IDE window during streaming does not leave old characters stranded.

- [ ] **Step 8: Verify shared TerminalTab consumers still work**

Open each terminal surface that uses `TerminalTab`:

- Main terminal tab from `src/v2/ContentViews.tsx`
- AgentZone real terminal from `src/v2/AgentZone.tsx`
- SSH terminal from `src/features/remote/SshTerminalSurface.tsx`

In each surface, run:

```bash
printf 'surface-ok\n'
```

Expected:

- `surface-ok` prints once.
- Input still reaches the session.
- Closing the surface does not produce console errors.

- [ ] **Step 9: Commit runtime verification notes only if a note file was created**

Do not create a note file by default. If the implementation worker created a verification note, commit only that note:

```bash
git add docs/architecture/terminal-runtime-verification-2026-06-17.md
git commit -m "docs: record terminal runtime verification"
```

Expected: skip this step when no note file exists.

## Final Verification Checklist

Run all commands before claiming completion:

```bash
bun test src/features/terminal/TerminalTab.test.ts
cargo test resize_session_updates_kernel_pty_size --manifest-path src-tauri/Cargo.toml
bun run build
```

Expected:

- `TerminalTab.test.ts` passes.
- Rust PTY resize test passes.
- Build exits with code `0`.
- Manual Tauri runtime verification confirms PTY dimensions track the visible terminal.
- Manual SIXEL verification renders the red rectangle.
- Claude Code TUI redraws do not leave overlapping stale text.

## Plan Self-Review

- Spec coverage: Task 1 covers the resize/PTY timing failure from `2026-06-16-011359-ide-terminals-ui.txt`. Task 2 covers the follow-up terminal image support request through SIXEL/iTerm support. Task 3 covers unit, Rust, build, and Tauri runtime verification.
- Placeholder scan: This plan uses concrete file paths, commands, expected outcomes, and code blocks for each implementation step.
- Type consistency: The plan consistently uses `TerminalDimensions`, `normalizeTerminalDimensions`, `sameTerminalDimensions`, `ImageAddon`, `FakeImageAddon`, `installAnimationFrameMock`, and existing `onResize` callback shape `(sessionId, rows, cols)`.

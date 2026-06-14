# HTML Language Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v2 recognize `.html` and `.htm` files as HTML instead of Plain Text in the editor language pipeline.

**Architecture:** Keep the fix in the existing pure helpers used by the v2 editor. `langForPath()` maps file paths to editor language ids, `langLabel()` maps those ids to status-bar labels, and `chipFor()` maps file names to compact explorer chips. Do not add an HTML LSP server in this task.

**Tech Stack:** React/Vite, TypeScript, Bun test, existing v2 pure helper tests.

---

### Task 1: Add HTML Language Recognition

**Files:**
- Modify: `src/v2/bridge.test.ts`
- Modify: `src/v2/v2-model.test.ts`
- Modify: `src/v2/bridge.ts`
- Modify: `src/v2/v2-model.ts`

- [x] **Step 1: Write the failing tests**

Add expectations that `.html` and `.htm` resolve to `html`, the status label renders as `HTML`, and the file chip is no longer the unknown dot:

```typescript
// src/v2/bridge.test.ts
expect(langForPath("index.html")).toBe("html")
expect(langForPath("templates/page.htm")).toBe("html")
```

```typescript
// src/v2/v2-model.test.ts
expect(langLabel("html")).toBe("HTML")
expect(chipFor("index.html")[0]).toBe("html")
expect(chipFor("page.htm")[0]).toBe("html")
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/v2/bridge.test.ts src/v2/v2-model.test.ts
```

Expected: FAIL because `langForPath("index.html")` currently returns `md`, `langLabel("html")` currently falls through to `Plain Text`, and `chipFor("index.html")` / `chipFor("page.htm")` currently return `·`.

- [x] **Step 3: Write minimal implementation**

Add `html` support to the existing helper maps only:

```typescript
// src/v2/bridge.ts
if (ext === "html" || ext === "htm") return "html"
```

```typescript
// src/v2/v2-model.ts
const KEYWORDS: Record<string, string> = {
    html: "",
}

const LANG_LABELS: Record<string, string> = {
    html: "HTML",
}

const M: Record<string, ChipColors> = {
    html: ["html", "var(--yz-10202e)", "var(--yz-82aaff)"],
    htm: ["html", "var(--yz-10202e)", "var(--yz-82aaff)"],
}
```

- [x] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
bun test src/v2/bridge.test.ts src/v2/v2-model.test.ts
```

Expected: PASS.

- [x] **Step 5: Run broader verification**

Run:

```bash
bun test src/v2/bridge.test.ts src/v2/v2-model.test.ts src/features/language/language-model.test.ts
bun run build
```

Expected: PASS. `bun run build` should complete with no TypeScript or Vite errors.

- [x] **Step 6: Request subagent review**

Dispatch reviewer subagents after implementation:

```text
Review the current diff for HTML language detection. Verify TDD tests were added first, `.html/.htm` map to editor language `html`, status label is `HTML`, file chip is `html`, and no HTML LSP/server behavior was added.
```

Expected: reviewer returns no Critical or Important issues before completion.

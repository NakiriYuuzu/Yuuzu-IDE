/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createDraftKey, loadDraft, saveDraft, clearDraft } from "./draft-store";

describe("draft store", () => {
  test("round trips draft content by workspace and path", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    const key = createDraftKey("workspace-a", "/workspace-a/src/main.ts");

    saveDraft(adapter, key, "draft text");

    expect(loadDraft(adapter, key)).toBe("draft text");
    clearDraft(adapter, key);
    expect(loadDraft(adapter, key)).toBeNull();
  });
});

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createDraftKey(workspaceId: string, path: string): string {
  return `yuuzu:draft:${workspaceId}:${path}`;
}

export function loadDraft(storage: DraftStorage, key: string): string | null {
  return storage.getItem(key);
}

export function saveDraft(
  storage: DraftStorage,
  key: string,
  content: string,
): void {
  storage.setItem(key, content);
}

export function clearDraft(storage: DraftStorage, key: string): void {
  storage.removeItem(key);
}

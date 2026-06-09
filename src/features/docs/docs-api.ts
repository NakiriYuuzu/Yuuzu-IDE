import { call } from "../../lib/tauri";
import type {
  ContextPack,
  DocIndexEntry,
  DocPreview,
  DocSearchResult,
} from "./docs-model";

export function getDocsIndex(workspaceRoot: string): Promise<DocIndexEntry[]> {
  return call("docs_index", { workspaceRoot });
}

export function getDocPreview(
  workspaceRoot: string,
  path: string,
): Promise<DocPreview> {
  return call("docs_preview", { workspaceRoot, path });
}

export function searchDocs(
  workspaceRoot: string,
  query: string,
): Promise<DocSearchResult> {
  return call("docs_search", { workspaceRoot, query });
}

export function listContextPacks(workspaceRoot: string): Promise<ContextPack[]> {
  return call("list_context_packs", { workspaceRoot });
}

export function createContextPack(args: {
  workspaceRoot: string;
  name: string;
  docPaths: string[];
}): Promise<ContextPack> {
  return call("create_context_pack", args);
}

export function deleteContextPack(id: string): Promise<void> {
  return call("delete_context_pack", { id });
}

export function linkContextPack(args: {
  id: string;
  taskRunId?: string | null;
  agentSessionId?: string | null;
}): Promise<ContextPack> {
  return call("link_context_pack", args);
}

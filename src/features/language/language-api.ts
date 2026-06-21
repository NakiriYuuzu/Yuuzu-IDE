import { call } from "../../lib/tauri";
import type {
  LanguageHover,
  LanguageServerStatus,
  LspDiagnostic,
} from "./language-model";
import { normalizeLanguageHover } from "./language-model";

export function getLanguageServerStatus(
  workspaceRoot: string,
): Promise<LanguageServerStatus[]> {
  return call("lsp_server_status", { workspaceRoot });
}

export function openLanguageDocument(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  content: string;
}): Promise<LanguageServerStatus> {
  return call("lsp_open_document", args);
}

export function closeLanguageDocument(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
}): Promise<LanguageServerStatus> {
  return call("lsp_close_document", args);
}

export function getWorkspaceDiagnostics(args: {
  workspaceId: string;
  workspaceRoot: string;
}): Promise<LspDiagnostic[]> {
  return call("lsp_workspace_diagnostics", args);
}

export function getDocumentDiagnostics(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
}): Promise<LspDiagnostic[]> {
  return call("lsp_document_diagnostics", args);
}

export function requestLanguageHover(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<LanguageHover | null> {
  return call<unknown>("lsp_hover", args).then((value) =>
    normalizeBackendLanguageHover(value, args),
  );
}

function normalizeBackendLanguageHover(
  value: unknown,
  args: { path: string; line: number; character: number },
): LanguageHover | null {
  const normalized = normalizeLanguageHover(value);
  if (normalized) return normalized;
  if (!value || typeof value !== "object" || !("contents" in value)) return null;

  const contents = stringifyHoverContents(
    (value as Record<string, unknown>).contents,
  );
  if (contents === null) return null;

  return {
    path: args.path,
    line: args.line,
    character: args.character,
    contents,
  };
}

function stringifyHoverContents(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map(stringifyHoverContents)
      .filter((part): part is string => part !== null)
      .join("\n");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.value === "string") return record.value;
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) return null;
  return String(value);
}

export function requestLanguageDefinition(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<unknown> {
  return call<unknown>("lsp_definition", args);
}

export function requestLanguageReferences(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<unknown> {
  return call<unknown>("lsp_references", args);
}

export function requestLanguageCompletion(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<unknown> {
  return call<unknown>("lsp_completion", args);
}

export function requestLanguageCodeActions(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<unknown> {
  return call<unknown>("lsp_code_actions", args);
}

export function requestLanguageRename(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
  newName: string;
}): Promise<unknown> {
  return call<unknown>("lsp_rename", args);
}

export function restartLanguageServer(args: {
  workspaceId: string;
  workspaceRoot: string;
  language: string;
}): Promise<LanguageServerStatus> {
  return call("lsp_restart_server", args);
}

export function getLanguageServerLogs(args: {
  workspaceId: string;
  workspaceRoot: string;
}): Promise<string[]> {
  return call("lsp_server_logs", args);
}

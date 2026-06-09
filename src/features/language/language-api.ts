import { call } from "../../lib/tauri";
import type {
  LanguageHover,
  LanguageServerStatus,
  LspDiagnostic,
} from "./language-model";

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

export function requestLanguageHover(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<LanguageHover | null> {
  return call("lsp_hover", args);
}

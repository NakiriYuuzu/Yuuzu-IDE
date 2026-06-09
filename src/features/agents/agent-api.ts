import { call } from "../../lib/tauri";
import type {
  AgentApprovalStatus,
  AgentContextItem,
  AgentMode,
  AgentPromptExport,
  AgentSession,
  AgentTranscriptEntry,
  AgentTranscriptInput,
} from "./agent-model";

export function listAgentSessions(workspaceRoot: string): Promise<AgentSession[]> {
  return call("list_agent_sessions", { workspaceRoot });
}

export function startAgentSession(args: {
  workspaceRoot: string;
  mode: AgentMode;
  prompt: string;
  contextItems: AgentContextItem[];
}): Promise<AgentSession> {
  return call("start_agent_session", args);
}

export function appendAgentTranscript(args: {
  sessionId: string;
  entry: AgentTranscriptInput;
}): Promise<AgentTranscriptEntry> {
  return call("append_agent_transcript", args);
}

export function updateAgentApproval(args: {
  sessionId: string;
  approvalId: string;
  status: AgentApprovalStatus;
}): Promise<AgentSession> {
  return call("update_agent_approval", args);
}

export function exportAgentPrompt(sessionId: string): Promise<AgentPromptExport> {
  return call("export_agent_prompt", { sessionId });
}

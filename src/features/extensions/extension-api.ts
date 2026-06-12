import { call } from "../../lib/tauri";
import type {
  ExtensionPerformanceSample,
  ExtensionWorkspaceStatus,
} from "./extension-model";

export function listExtensionStatuses(
  workspaceRoot: string,
): Promise<ExtensionWorkspaceStatus[]> {
  return call("extension_statuses", { workspaceRoot });
}

export function setExtensionEnabled(args: {
  workspaceRoot: string;
  extensionId: string;
  enabled: boolean;
}): Promise<ExtensionWorkspaceStatus[]> {
  return call("set_extension_enabled", {
    workspaceRoot: args.workspaceRoot,
    extensionId: args.extensionId,
    enabled: args.enabled,
  });
}

export function recordExtensionPerformance(args: {
  workspaceRoot: string;
  sample: ExtensionPerformanceSample;
}): Promise<ExtensionWorkspaceStatus[]> {
  return call("record_extension_performance", {
    workspaceRoot: args.workspaceRoot,
    sample: args.sample,
  });
}

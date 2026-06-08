import { invoke } from "@tauri-apps/api/core";

type CommandArgs = Record<string, unknown>;

export function call<T>(command: string, args?: CommandArgs): Promise<T> {
  return invoke<T>(command, args);
}

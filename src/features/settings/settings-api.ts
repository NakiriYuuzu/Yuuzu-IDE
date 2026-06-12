import { call } from "../../lib/tauri";
import type { AppSettings, AppSettingsInput } from "./settings-model";

export function loadSettings(): Promise<AppSettingsInput> {
  return call("load_settings");
}

export function saveSettings(settings: AppSettings): Promise<AppSettingsInput> {
  return call("save_settings", { settings });
}

export function importKeybindings(args: {
  source: "vscode";
  content: string;
}): Promise<AppSettings> {
  return call("import_keybindings", args);
}

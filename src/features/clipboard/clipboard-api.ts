import { call } from "../../lib/tauri";

export function writeClipboardText(text: string): Promise<void> {
  return call<void>("write_clipboard_text", { text });
}

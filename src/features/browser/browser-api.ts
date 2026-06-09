import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserPreviewBounds,
  BrowserScreenshot,
  BrowserUrl,
} from "./browser-model";

export type BrowserCaptureRequest = {
  url: string;
  title: string;
  bounds: BrowserPreviewBounds;
};

export function validateBrowserUrl(url: string): Promise<BrowserUrl> {
  return invoke<BrowserUrl>("browser_validate_url", { url });
}

export function captureBrowserPreview(args: {
  workspaceRoot: string;
  request: BrowserCaptureRequest;
}): Promise<BrowserScreenshot> {
  return invoke<BrowserScreenshot>("browser_capture_preview", {
    workspaceRoot: args.workspaceRoot,
    request: args.request,
  });
}

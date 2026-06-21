import { Window as HappyWindow } from "happy-dom";

let sharedHappyWindow: unknown = null;

export function ensureTestDom(): void {
  if (globalThis.document) {
    if (globalThis.document.body) {
      globalThis.document.body.innerHTML = "";
    }

    if (globalThis.document.head) {
      globalThis.document.head.innerHTML = "";
    }

    if (!globalThis.window) {
      globalThis.window = sharedHappyWindow as Window & typeof globalThis;
    }

    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, "navigator", {
        value: ((sharedHappyWindow as { navigator?: typeof globalThis.navigator })
          ?.navigator ?? globalThis).navigator,
        configurable: true,
      });
    }

    const existingWindow = sharedHappyWindow as { MutationObserver?: typeof MutationObserver } | null;
    if (!globalThis.MutationObserver && existingWindow?.MutationObserver) {
      globalThis.MutationObserver = existingWindow.MutationObserver;
    }

    return;
  }

  sharedHappyWindow = new HappyWindow({ url: "http://localhost/" });
  const testWindow = sharedHappyWindow as any;

  globalThis.window = testWindow as unknown as Window & typeof globalThis;
  globalThis.document = testWindow.document as unknown as Document;
  globalThis.HTMLElement = testWindow.HTMLElement as unknown as typeof HTMLElement;
  globalThis.HTMLInputElement =
    testWindow.HTMLInputElement as unknown as typeof HTMLInputElement;
  globalThis.Event = testWindow.Event as unknown as typeof Event;
  globalThis.MouseEvent = testWindow.MouseEvent as unknown as typeof MouseEvent;
  globalThis.KeyboardEvent = testWindow.KeyboardEvent as unknown as typeof KeyboardEvent;
  globalThis.PointerEvent = testWindow.PointerEvent as unknown as typeof PointerEvent;
  globalThis.MutationObserver =
    testWindow.MutationObserver as unknown as typeof MutationObserver;

  Object.defineProperty(globalThis, "navigator", {
    value: testWindow.navigator,
    configurable: true,
  });
}

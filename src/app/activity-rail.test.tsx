/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";

import { ActivityRail } from "./activity-rail";

const testWindow = new HappyWindow({ url: "http://localhost/" });
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement as unknown as typeof HTMLElement;
globalThis.HTMLInputElement =
  testWindow.HTMLInputElement as unknown as typeof HTMLInputElement;
globalThis.Event = testWindow.Event as unknown as typeof Event;
globalThis.MouseEvent = testWindow.MouseEvent as unknown as typeof MouseEvent;
Object.defineProperty(globalThis, "navigator", {
  value: testWindow.navigator,
  configurable: true,
});

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

describe("ActivityRail", () => {
  test("renders agents activity and badge", () => {
    const result = render(
      <ActivityRail
        active="agents"
        badges={{ agents: "2", git: "1" }}
        onSelect={() => {}}
      />,
    );

    expect(result.getByLabelText("Agents")).toBeTruthy();
    expect(result.getByText("2")).toBeTruthy();
  });

  test("selects agents and notifies callback", () => {
    const onSelect = mock(() => {});
    const result = render(
      <ActivityRail
        active="explorer"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(result.getByLabelText("Agents"));

    expect(onSelect).toHaveBeenCalledWith("agents");
  });
});

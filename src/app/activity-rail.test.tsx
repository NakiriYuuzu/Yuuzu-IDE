/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ActivityRail } from "./activity-rail";
import { ensureTestDom } from "./test-dom";

ensureTestDom();

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

  test("renders browser activity and badge", () => {
    const result = render(
      <ActivityRail
        active="explorer"
        onSelect={() => {}}
      />,
    );

    expect(result.getByLabelText("Browser")).toBeTruthy();
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

  test("selects browser and notifies callback", () => {
    const onSelect = mock(() => {});
    const result = render(
      <ActivityRail
        active="explorer"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(result.getByLabelText("Browser"));

    expect(onSelect).toHaveBeenCalledWith("browser");
  });

  test("renders remote activity and notifies callback", () => {
    const onSelect = mock(() => {});
    const result = render(
      <ActivityRail
        active="explorer"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(result.getByLabelText("Remotes"));

    expect(onSelect).toHaveBeenCalledWith("remote");
  });
});

/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createWorkspaceViewStore } from "./workspace-view-state";

describe("createWorkspaceViewStore", () => {
  test("restores surface and activity per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView("alpha", {
      surface: "editor",
      activeActivity: "search",
    });
    store.getState().updateView("beta", {
      surface: "terminal",
      activeActivity: "terminal",
    });

    expect(store.getState().viewFor("alpha")).toMatchObject({
      surface: "editor",
      activeActivity: "search",
    });
    expect(store.getState().viewFor("beta")).toMatchObject({
      surface: "terminal",
      activeActivity: "terminal",
    });
  });

  test("empty workspace id uses a stable shell view", () => {
    const store = createWorkspaceViewStore();

    expect(store.getState().viewFor(null)).toMatchObject({
      surface: "empty",
      activeActivity: "explorer",
      panelOpen: true,
    });
  });

  test("shell view can be updated", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView(null, {
      surface: "terminal",
      activeActivity: "terminal",
      panelOpen: false,
    });

    expect(store.getState().viewFor(null)).toMatchObject({
      surface: "terminal",
      activeActivity: "terminal",
      panelOpen: false,
    });
  });

  test("partial workspace updates preserve existing fields", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView("alpha", {
      surface: "editor",
      panelOpen: false,
    });
    store.getState().updateView("alpha", {
      activeActivity: "search",
    });

    expect(store.getState().viewFor("alpha")).toMatchObject({
      surface: "editor",
      activeActivity: "search",
      panelOpen: false,
    });
  });

  test("unknown workspace defaults use a stable reference", () => {
    const store = createWorkspaceViewStore();

    expect(store.getState().viewFor("unknown")).toBe(
      store.getState().viewFor("unknown"),
    );
  });

  test("unknown workspace defaults cannot be mutated across future defaults", () => {
    const store = createWorkspaceViewStore();

    const unknownView = store.getState().viewFor("unknown");

    expect(() => {
      unknownView.surface = "terminal";
    }).toThrow(TypeError);

    expect(store.getState().viewFor("other-unknown")).toMatchObject({
      surface: "empty",
      activeActivity: "explorer",
      panelOpen: true,
    });
  });
});

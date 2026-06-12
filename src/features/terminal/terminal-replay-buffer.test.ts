/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  appendTerminalReplayOutput,
  clearTerminalReplayOutput,
  replayTerminalOutput,
  subscribeTerminalChunks,
} from "./terminal-replay-buffer";

describe("terminal replay buffer", () => {
  test("appends chunks per session and replays them in order", () => {
    appendTerminalReplayOutput("w:replay-1", "boot\n");
    appendTerminalReplayOutput("w:replay-1", "ready\n");

    expect(replayTerminalOutput("w:replay-1")).toBe("boot\nready\n");
  });

  test("replay of an unknown session is empty", () => {
    expect(replayTerminalOutput("w:replay-unknown")).toBe("");
  });

  test("replay output is bounded to the trailing 120k characters", () => {
    appendTerminalReplayOutput("w:replay-2", "a".repeat(120_000));
    appendTerminalReplayOutput("w:replay-2", "tail");

    const replay = replayTerminalOutput("w:replay-2");
    expect(replay).toHaveLength(120_000);
    expect(replay).toEndWith("tail");
  });

  test("sessions are isolated", () => {
    appendTerminalReplayOutput("w:replay-3", "three");
    appendTerminalReplayOutput("w:replay-4", "four");

    expect(replayTerminalOutput("w:replay-3")).toBe("three");
    expect(replayTerminalOutput("w:replay-4")).toBe("four");
  });

  test("subscribers receive each appended chunk after replay state updates", () => {
    const received: string[] = [];
    const unsubscribe = subscribeTerminalChunks("w:replay-5", (chunk) => {
      received.push(`${chunk}|${replayTerminalOutput("w:replay-5")}`);
    });

    appendTerminalReplayOutput("w:replay-5", "one");
    appendTerminalReplayOutput("w:replay-5", "two");
    unsubscribe();
    appendTerminalReplayOutput("w:replay-5", "three");

    expect(received).toEqual(["one|one", "two|onetwo"]);
    expect(replayTerminalOutput("w:replay-5")).toBe("onetwothree");
  });

  test("subscribers only receive chunks for their own session", () => {
    const received: string[] = [];
    const unsubscribe = subscribeTerminalChunks("w:replay-6", (chunk) => {
      received.push(chunk);
    });

    appendTerminalReplayOutput("w:replay-7", "other session");

    expect(received).toEqual([]);
    unsubscribe();
  });

  test("clear removes the replay buffer for one session only", () => {
    appendTerminalReplayOutput("w:replay-8", "gone");
    appendTerminalReplayOutput("w:replay-9", "kept");

    clearTerminalReplayOutput("w:replay-8");

    expect(replayTerminalOutput("w:replay-8")).toBe("");
    expect(replayTerminalOutput("w:replay-9")).toBe("kept");
  });
});

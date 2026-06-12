import { describe, expect, test } from "bun:test";
import {
  createGitLogState,
  storeLogPage,
  setLogFilter,
  selectLogCommit,
  storeCommitDetail,
  edgePath,
  laneX,
  openExportDialog,
  setExportField,
} from "./git-log-model";
import type { GitCommitDetail, GitLogRow } from "./git-log-model";

const row = (hash: string, lane = 0, edges: GitLogRow["edges"] = []): GitLogRow => ({
  hash,
  short_hash: hash.slice(0, 7),
  subject: "s",
  author: "a",
  when_unix: 1,
  refs: [],
  parents: [],
  lane,
  lane_overflow: false,
  merge: false,
  edges,
});

describe("git log model", () => {
  test("storeLogPage replaces rows and tracks has_more", () => {
    const next = storeLogPage(createGitLogState(), {
      rows: [row("aaaaaaa1"), row("aaaaaaa2", 1)],
      has_more: true,
      total_loaded: 2,
      truncated: false,
    });
    expect(next.rows.length).toBe(2);
    expect(next.hasMore).toBe(true);
    expect(next.loadedPages).toBe(1);
  });

  test("setLogFilter resets pagination", () => {
    let s = storeLogPage(createGitLogState(), {
      rows: [row("a1234567")],
      has_more: true,
      total_loaded: 1,
      truncated: false,
    });
    s = setLogFilter(s, { author: "mina" });
    expect(s.rows.length).toBe(0);
    expect(s.loadedPages).toBe(0);
    expect(s.filter.author).toBe("mina");
  });

  test("selectLogCommit stores selection and detail cache is keyed by hash", () => {
    let s = storeLogPage(createGitLogState(), {
      rows: [row("abc1234")],
      has_more: false,
      total_loaded: 1,
      truncated: false,
    });
    s = selectLogCommit(s, "abc1234");
    s = storeCommitDetail(s, {
      hash: "abc1234",
      files: [],
      files_truncated: false,
    } as never as GitCommitDetail);
    expect(s.selectedHash).toBe("abc1234");
    expect(s.detailByHash["abc1234"]).toBeDefined();
  });

  test("edgePath renders svg paths for through/fork/join", () => {
    expect(edgePath({ from_lane: 0, to_lane: 0, kind: "through" })).toBe(
      "M14 -4 L14 40",
    );
    expect(edgePath({ from_lane: 0, to_lane: 1, kind: "fork" })).toBe(
      "M14 18 C 14 30, 34 28, 34 40",
    );
    expect(edgePath({ from_lane: 1, to_lane: 0, kind: "join" })).toBe(
      "M34 -4 C 34 8, 14 10, 14 18",
    );
    expect(laneX(2)).toBe(54);
  });

  test("export dialog state transitions", () => {
    let s = openExportDialog(createGitLogState(), "abc1234");
    s = setExportField(s, "scope", "snapshot");
    s = setExportField(s, "format", "zip");
    expect(s.exportDialog).toEqual({
      hash: "abc1234",
      scope: "snapshot",
      format: "zip",
      destination: "",
      overwrite: false,
    });
  });
});

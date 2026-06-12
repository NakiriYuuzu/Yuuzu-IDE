const MAX_OUTPUT_CHARS = 120_000;

type ChunkListener = (chunk: string) => void;

const replayBySessionId = new Map<string, string>();
const listenersBySessionId = new Map<string, Set<ChunkListener>>();

export function appendTerminalReplayOutput(
  sessionId: string,
  chunk: string,
): void {
  const output = `${replayBySessionId.get(sessionId) ?? ""}${chunk}`;
  replayBySessionId.set(
    sessionId,
    output.slice(Math.max(0, output.length - MAX_OUTPUT_CHARS)),
  );

  const listeners = listenersBySessionId.get(sessionId);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener(chunk);
  }
}

export function replayTerminalOutput(sessionId: string): string {
  return replayBySessionId.get(sessionId) ?? "";
}

export function subscribeTerminalChunks(
  sessionId: string,
  listener: ChunkListener,
): () => void {
  let listeners = listenersBySessionId.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    listenersBySessionId.set(sessionId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersBySessionId.delete(sessionId);
    }
  };
}

export function clearTerminalReplayOutput(sessionId: string): void {
  replayBySessionId.delete(sessionId);
}

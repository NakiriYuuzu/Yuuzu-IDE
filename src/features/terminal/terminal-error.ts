export type TerminalLoadFailureCopy = {
  title: string;
  detail: string;
};

export function terminalLoadFailureCopy(error: unknown): TerminalLoadFailureCopy {
  return {
    title: "Terminal failed to load",
    detail: errorMessage(error),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return "Unable to initialize xterm.";
}

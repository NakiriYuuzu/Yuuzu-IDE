export type TaskProblem = {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
};

const MAX_PROBLEMS = 100;

const rustProblemPattern =
  /^(?<file>[^:(]+):(?<line>\d+):(?<column>\d+): (?<severity>error|warning): (?<message>.+)$/;
const typescriptProblemPattern =
  /^(?<file>.+)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning) (?<message>.+)$/;

export function matchProblems(output: string): TaskProblem[] {
  const problems: TaskProblem[] = [];

  for (const line of output.split(/\r?\n/)) {
    const problem = matchProblemLine(line.trim());
    if (problem) {
      problems.push(problem);
    }

    if (problems.length >= MAX_PROBLEMS) {
      break;
    }
  }

  return problems;
}

function matchProblemLine(line: string): TaskProblem | null {
  const match =
    rustProblemPattern.exec(line) ?? typescriptProblemPattern.exec(line);
  const groups = match?.groups;

  if (!groups) {
    return null;
  }

  return {
    file: groups.file,
    line: Number(groups.line),
    column: Number(groups.column),
    severity: groups.severity === "warning" ? "warning" : "error",
    message: groups.message,
  };
}

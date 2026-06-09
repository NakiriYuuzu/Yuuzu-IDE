import {
  BookOpenText,
  ClipboardList,
  Database,
  Files,
  GitBranch,
  Languages,
  Bot,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ActivityId =
  | "explorer"
  | "search"
  | "git"
  | "terminal"
  | "tasks"
  | "docs"
  | "language"
  | "agents"
  | "database"
  | "settings";

type ActivityItem = {
  id: ActivityId;
  label: string;
  icon: LucideIcon;
};

const activities: ActivityItem[] = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "tasks", label: "Tasks", icon: ClipboardList },
  { id: "docs", label: "Docs", icon: BookOpenText },
  { id: "language", label: "Language", icon: Languages },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "database", label: "Database", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];

type ActivityRailProps = {
  active: ActivityId;
  badges?: Partial<Record<ActivityId, string | null>>;
  onSelect: (activity: ActivityId) => void;
};

export function ActivityRail({ active, badges, onSelect }: ActivityRailProps) {
  return (
    <nav className="rail" aria-label="Primary workspace tools">
      {activities.map((activity) => {
        const Icon = activity.icon;
        const badge = badges?.[activity.id] ?? null;

        return (
          <button
            type="button"
            key={activity.id}
            className={`railbtn${active === activity.id ? " on" : ""}`}
            title={activity.label}
            aria-label={activity.label}
            aria-pressed={active === activity.id}
            onClick={() => onSelect(activity.id)}
          >
            <Icon aria-hidden="true" />
            {badge ? <span className="badge">{badge}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

import {
  Database,
  Files,
  GitBranch,
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
  | "database"
  | "settings";

type ActivityItem = {
  id: ActivityId;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

const activities: ActivityItem[] = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Git", icon: GitBranch, badge: "3" },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "database", label: "Database", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];

type ActivityRailProps = {
  active: ActivityId;
  onSelect: (activity: ActivityId) => void;
};

export function ActivityRail({ active, onSelect }: ActivityRailProps) {
  return (
    <nav className="rail" aria-label="Primary workspace tools">
      {activities.map((activity) => {
        const Icon = activity.icon;
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
            {activity.badge ? <span className="badge">{activity.badge}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

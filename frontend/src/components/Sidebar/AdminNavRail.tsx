import askvoxLogo from "../TopBars/AskVox.png";
// Use the provided PNGs placed under src/pages/admin
import dashboardPng from "../../pages/admin/dashboard.png";
import flaggedPng from "../../pages/admin/flaggedresponse.png";
import reviewedPng from "../../pages/admin/reviewed.png";
import { Settings } from "lucide-react";
import "./cssfiles/NavRail.css";

interface AdminNavRailProps {
  active?: string;
  onNavigate: (path: string) => void;
}

type NavItem = { key: string; label: string; icon: string; top: number; path?: string; disabled?: boolean };

const DASHBOARD_ICON_URL = dashboardPng;
const FLAGGED_ICON_URL = flaggedPng;
const REVIEWED_ICON_URL = reviewedPng;
const ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: DASHBOARD_ICON_URL, top: 124, path: "/platformadmin/dashboard" },
  { key: "flagged", label: "Flagged Response", icon: FLAGGED_ICON_URL, top: 260, path: "/platformadmin/flagged" },
  { key: "reviewed", label: "Reviewed", icon: REVIEWED_ICON_URL, top: 396, path: "/platformadmin/education" },
];

export default function AdminNavRail({ active = "dashboard", onNavigate }: AdminNavRailProps) {
  const handleClick = (item: NavItem) => { if (item.path && !item.disabled) onNavigate(item.path); };
  return (
    <div className="av-rail">
      {/* Logo */}
      <button className="av-rail__logoBtn" type="button" onClick={() => onNavigate("/platformadmin/dashboard")}>
        <img className="av-rail__logo" src={askvoxLogo} alt="AskVox" />
      </button>

      {/* Items */}
      {ITEMS.map((it) => {
        const isActive = active === it.key;
        return (
          <button
            key={it.key}
            type="button"
            className={`av-rail__item ${isActive ? "is-active" : ""}`}
            style={{ top: it.top }}
            onClick={() => handleClick(it)}
            disabled={Boolean(it.disabled)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="av-rail__iconWrap">
              <img
                className="av-rail__icon"
                src={it.icon}
                alt=""
                style={{ width: 50, height: 50 }}
              />
            </span>
            <span className="av-rail__label admin-label">{it.label}</span>
          </button>
        );
      })}

      {/* Settings at bottom */}
      <button
        type="button"
        className="admin-settings"
        onClick={() => onNavigate("/settings/account")}
        aria-label="Admin settings"
        title="Settings"
      >
        <Settings size={28} color="#ffffff" />
      </button>
    </div>
  );
}

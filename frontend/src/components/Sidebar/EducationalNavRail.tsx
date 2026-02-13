import askvoxLogo from "../TopBars/AskVox.png";
import checkerIcon from "../../assets/educational/checker.png";
import { Settings } from "lucide-react";
import "./cssfiles/NavRail.css";

interface EducationalNavRailProps {
  activeTab: "checker" | "settings";
  onNavigate: (path: string) => void;
}

type NavItem = {
  key: "checker" | "settings";
  label: string;
  icon?: string;
  top: number;
  path: string;
};

const ITEMS: NavItem[] = [
  { key: "checker", label: "Checker", icon: checkerIcon, top: 124, path: "/educationInstitutional" },
];

export default function EducationalNavRail({ activeTab, onNavigate }: EducationalNavRailProps) {
  return (
    <div className="av-rail">
      {/* Logo */}
      <button className="av-rail__logoBtn" type="button" onClick={() => onNavigate("/educationInstitutional")}>
        <img className="av-rail__logo" src={askvoxLogo} alt="AskVox" />
      </button>

      {/* Educational Items */}
      {ITEMS.map((it) => {
        const isActive = activeTab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            className={`av-rail__item ${isActive ? "is-active" : ""}`}
            style={{ top: it.top }}
            onClick={() => onNavigate(it.path)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="av-rail__iconWrap">
              {it.icon ? <img className="av-rail__icon" src={it.icon} alt="" /> : null}
            </span>
            <span className="av-rail__label">{it.label}</span>
          </button>
        );
      })}

      {/* Settings at bottom */}
      <button
        type="button"
        className="admin-settings"
        onClick={() => onNavigate("/educationaluser/settings")}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={28} color="#ffffff" />
      </button>
    </div>
  );
}

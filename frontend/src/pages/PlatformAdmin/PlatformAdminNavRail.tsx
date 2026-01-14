import { useNavigate } from "react-router-dom";

import askvoxLogo from "./asset/AskVox.png";
import dashboardIcon from "./asset/dashboard.png";
import flaggedIcon from "./asset/chat.png";
import reviewedIcon from "./asset/reviewed.png";
import settingIcon from "./asset/setting.png";

import "./navrail.css";

interface NavRailProps {
  activeTab: string;
  onTabClick: (tab: string) => void;
  onOpenSidebar?: (tab: string) => void;
}

type NavItem = {
  key: string;
  label: string;
  icon: string;
  top: number;
};

const ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: dashboardIcon, top: 120 },
  { key: "flagged", label: "Flagged Response", icon: flaggedIcon, top: 220 },
  { key: "reviewed", label: "Reviewed", icon: reviewedIcon, top: 344 },
  // setting 아이콘을 nav item처럼 “사진만” 원하셨던 형태로 추가
  { key: "settings", label: "Settings", icon: settingIcon, top: 881 },
];

export default function PlatformAdminNavRail({
  activeTab,
  onTabClick,
  onOpenSidebar,
}: NavRailProps) {
  const navigate = useNavigate();

  const go = (tab: string) => {
    // ✅ 1) 상태/사이드바 콜백 유지
    onTabClick(tab);
    onOpenSidebar?.(tab);

    // ✅ 2) 라우팅 이동
    if (tab === "dashboard") navigate("/platformadmin/dashboard");
    if (tab === "flagged") navigate("/platformadmin/flagged");
    if (tab === "reviewed") navigate("/platformadmin/reviewed");
    if (tab === "settings") navigate("/platformadmin/settings");
  };

  return (
    <div className="av-rail">
      {/* LOGO */}
      <button
        className="av-rail__logoBtn"
        type="button"
        onClick={() => go("dashboard")}
      >
        <img className="av-rail__logo" src={askvoxLogo} alt="AskVox" />
      </button>

      {/* NAV ITEMS */}
      {ITEMS.map((it) => {
        const isActive = activeTab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            className={`av-rail__item ${isActive ? "is-active" : ""}`}
            style={{ top: it.top }}
            onClick={() => go(it.key)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="av-rail__iconWrap">
              <img className="av-rail__icon" src={it.icon} alt="" />
            </span>
            <span className="av-rail__label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

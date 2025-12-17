

interface NavRailProps {
  activeTab: string;
  onTabClick: (tab: string) => void;

  
  onOpenSidebar?: (tab: string) => void;
}


import askvoxLogo from "../TopBars/AskVox.png";
import chatsIcon from "./chat.png";
import discoverIcon from "./news.png";
import smartrecIcon from "./rec.png";
import newChatIcon from "./newchat.png";
// settings later (you said come to it later) — keep placeholder if you want
// import settingsIcon from "../../assets/settings.png";
import "./cssfiles/NavRail.css";

type NavItem = {
  key: string;
  label: string;
  icon: string;
  top: number; // px from top inside the rail
};

const ITEMS: NavItem[] = [
  { key: "newchat", label: "New Chat", icon: newChatIcon, top: 124 },
  { key: "chats", label: "Chats", icon: chatsIcon, top: 220 },
  { key: "discover", label: "Discover", icon: discoverIcon, top: 320 },
  { key: "smartrec", label: "SmartRec", icon: smartrecIcon, top: 424 },
];

export default function NavRail({ activeTab, onTabClick, onOpenSidebar }: NavRailProps) {
  const handleClick = (tab: string) => {
    onTabClick(tab);
    onOpenSidebar?.(tab); // opens sidebar options
  };

  return (
    <div className="av-rail">
      {/* LOGO */}
      <button className="av-rail__logoBtn" type="button" onClick={() => handleClick("reguserhome")}>
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
            onClick={() => handleClick(it.key)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="av-rail__iconWrap">
              <img className="av-rail__icon" src={it.icon} alt="" />
            </span>
            <span className="av-rail__label">{it.label}</span>
          </button>
        );
      })}

      {/* SETTINGS (later)
          Keeping the slot so layout matches your design.
          When ready, just swap the placeholder button into a real one with settings.png.
      */}
      <button
        type="button"
        className="av-rail__settingsSlot"
        onClick={() => handleClick("settings")}
        aria-label="Settings"
      />
    </div>
  );
}
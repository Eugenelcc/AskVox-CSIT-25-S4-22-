import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient"; 
import askvoxLogo from "../TopBars/AskVox.png";
import chatsIcon from "./chat.png";
import discoverIcon from "./news.png";
import smartrecIcon from "./rec.png";
import newChatIcon from "./newchat.png";
import { Settings } from "lucide-react";
import "./cssfiles/NavRail.css";

interface NavRailProps {
  activeTab: string;
  onTabClick: (tab: string) => void;
  onOpenSidebar?: (tab: string) => void;

  // ✅ Add these so NavRail can display the avatar
  // Store this as a STORAGE PATH for private bucket, e.g. "defaults/default.png" or "userId/avatar.png"
  avatarPath?: string | null;
}

type NavItem = {
  key: string;
  label: string;
  icon: string;
  top: number;
};

const ITEMS: NavItem[] = [
  { key: "newchat", label: "New Chat", icon: newChatIcon, top: 124 },
  { key: "chats", label: "Chats", icon: chatsIcon, top: 220 },
  { key: "discover", label: "Discover", icon: discoverIcon, top: 320 },
  { key: "smartrec", label: "SmartRec", icon: smartrecIcon, top: 424 },
];

export default function NavRail({ activeTab, onTabClick, onOpenSidebar, avatarPath }: NavRailProps) {
  const [avatarSrc, setAvatarSrc] = useState<string>("");

  const handleClick = (tab: string) => {
    onTabClick(tab);
    onOpenSidebar?.(tab);
  };

  // ✅ Private bucket: convert stored path -> signed URL for display
  useEffect(() => {
    let cancelled = false;


    const loadAvatar = async () => {
      if (!avatarPath) {
        setAvatarSrc("");
        return;
      }

      if (/^https?:\/\//i.test(avatarPath)) {
        setAvatarSrc(avatarPath);
        return;
      }

      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(avatarPath, 60 * 60 * 24 * 7); // 7 days

      if (cancelled) return;

      if (error) {
        console.error("Failed to create signed avatar URL:", error.message);
        setAvatarSrc("");
        return;
      }
      
      setAvatarSrc(data?.signedUrl ?? "");
    };

    loadAvatar();

    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

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

      {/* ✅ PROFILE + SETTINGS (bottom) */}
      <button
        type="button"
        className="av-rail__profileBtn"
        onClick={() => handleClick("settings")}
        aria-label="Profile settings"
        title="Settings"
      >
        <span className="av-rail__profileRing">
          {avatarSrc ? (
            <img className="av-rail__profileImg" src={avatarSrc} alt="Profile" />
          ) : (
            <span className="av-rail__profileFallback" />
          )}
        </span>

        <span className="av-rail__profileGear" aria-hidden="true">
          <Settings size={18} />
        </span>
      </button>
    </div>
  );
}

import "./cssfiles/Settings_Sidebar.css";
import { Lock, PanelLeftClose } from "lucide-react";

type SettingsKey = "account" | "billing" | "delete" | "wakeword";

interface SettingsSidebarProps {
  isOpen: boolean;
  activeKey?: SettingsKey | null;
  onSelect?: (key: SettingsKey) => void;
  onClose: () => void;
  wakeWordLocked?: boolean;
  onWakeWordLockedClick?: () => void;
}

export default function SettingsSidebar({
  isOpen,
  activeKey = null,
  onSelect,
  onClose,
  wakeWordLocked = false,
  onWakeWordLockedClick,
}: SettingsSidebarProps) {
  if (!isOpen) return null;

  const pick = (k: SettingsKey) => onSelect?.(k);

  const onWakeWordClick = () => {
    if (wakeWordLocked) {
      onWakeWordLockedClick?.();
      return;
    }
    pick("wakeword");
  };

  return (
    <aside className="av-settings" aria-label="Settings Sidebar">
      <button
        className="av-settings__hideBtn"
        type="button"
        onClick={onClose}
        aria-label="Collapse settings"
        title="Collapse"
      >
        <PanelLeftClose size={22} />
      </button>

      <div className="av-settings__title">Setting</div>
      <div className="av-settings__divider" />

      <nav className="av-settings__menu" aria-label="Settings menu">
        <button
          type="button"
          className={`av-settings__item ${activeKey === "account" ? "is-active" : ""}`}
          onClick={() => pick("account")}
        >
          Account Details
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "billing" ? "is-active" : ""}`}
          onClick={() => pick("billing")}
        >
          Payment &amp; Billing
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "delete" ? "is-active" : ""}`}
          onClick={() => pick("delete")}
        >
          Delete Account
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "wakeword" && !wakeWordLocked ? "is-active" : ""}`}
          onClick={onWakeWordClick}
          aria-disabled={wakeWordLocked}
          title={wakeWordLocked ? "Premium features" : undefined}
        >
          <span style={{ flex: 1 }}>Customize Wake Word</span>
          {wakeWordLocked && <Lock size={16} style={{ opacity: 0.8 }} />}
        </button>
      </nav>
    </aside>
  );
}

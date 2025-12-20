import "./cssfiles/Settings_Sidebar.css";
import { PanelLeftClose } from "lucide-react";

type SettingsKey = "account" | "billing" | "delete" | "wakeword";

interface SettingsSidebarProps {
  isOpen: boolean;
  activeKey?: SettingsKey | null;
  onSelect?: (key: SettingsKey) => void;
  onClose: () => void;
}

export default function SettingsSidebar({
  isOpen,
  activeKey = null,
  onSelect,
  onClose,
}: SettingsSidebarProps) {
  if (!isOpen) return null;

  const pick = (k: SettingsKey) => onSelect?.(k);

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
          className={`av-settings__item ${activeKey === "wakeword" ? "is-active" : ""}`}
          onClick={() => pick("wakeword")}
        >
          Customize Wake Word
        </button>
      </nav>
    </aside>
  );
}

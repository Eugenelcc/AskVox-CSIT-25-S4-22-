import React from 'react';
import "./cssfiles/Settings_Sidebar.css";
import { PanelLeftClose } from "lucide-react";
import type { UiCategory } from '../../services/newsApi'; // Optional: import shared type if you want strict safety

// These keys must match the keys in CATEGORY_MAP in newsApi.ts
type DiscoverKey =
  | "Trending"
  | "Technology"
  | "Science"
  | "Gaming"
  | "Finance & Business"
  | "History & World Events"
  | "Sports"
  | "Cooking & Food"
  | "Entertainment"
  | "Education"
  | "Geography & Travel";

interface DiscoverSidebarProps {
  isOpen: boolean;
  activeKey?: string | null; // Changed to string to be more flexible
  onCategorySelect?: (key: string) => void;
  onClose: () => void;
}


export default function DiscoverSidebar({
  isOpen,
  activeKey = null,
  onCategorySelect,
  onClose,
}: DiscoverSidebarProps) {
  if (!isOpen) return null;

  const pick = (k: DiscoverKey) => {
    onCategorySelect?.(k);
  };

  return (
    <aside className="av-settings" aria-label="Discover Sidebar">
      <button
        className="av-settings__hideBtn"
        type="button"
        onClick={onClose}
        aria-label="Collapse sidebar"
        title="Collapse"
      >
        <PanelLeftClose size={22} />
      </button>

      <div className="av-settings__title">Discover</div>
      <div className="av-settings__divider" />

      <nav className="av-settings__menu" aria-label="Discover categories">
        
        <button
          type="button"
          className={`av-settings__item ${activeKey === "Trending" ? "is-active" : ""}`}
          onClick={() => pick("Trending")}
        >
          Trending
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Technology" ? "is-active" : ""}`}
          onClick={() => pick("Technology")}
        >
          Technology
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Science" ? "is-active" : ""}`}
          onClick={() => pick("Science")}
        >
          Science
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Finance & Business" ? "is-active" : ""}`}
          onClick={() => pick("Finance & Business")}
        >
          Finance & Business
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "History & World Events" ? "is-active" : ""}`}
          onClick={() => pick("History & World Events")}
        >
          History & World Events
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Sports" ? "is-active" : ""}`}
          onClick={() => pick("Sports")}
        >
          Sports
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Cooking & Food" ? "is-active" : ""}`}
          onClick={() => pick("Cooking & Food")}
        >
          Cooking & Food
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Geography & Travel" ? "is-active" : ""}`}
          onClick={() => pick("Geography & Travel")}
        >
          Geography & Travel
        </button>

         <button
          type="button"
          className={`av-settings__item ${activeKey === "Gaming" ? "is-active" : ""}`}
          onClick={() => pick("Gaming")}
        >
          Gaming
        </button>

        <button
          type="button"
          className={`av-settings__item ${activeKey === "Entertainment" ? "is-active" : ""}`}
          onClick={() => pick("Entertainment")}
        >
          Entertainment
        </button>


        <button
          type="button"
          className={`av-settings__item ${activeKey === "Education" ? "is-active" : ""}`}
          onClick={() => pick("Education")}
        >
          Education
        </button>

      </nav>
    </aside>
  );
}
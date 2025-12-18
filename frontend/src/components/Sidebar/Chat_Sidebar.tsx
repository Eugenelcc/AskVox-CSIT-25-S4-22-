import React, { useEffect, useMemo, useRef, useState } from "react";
import "./cssfiles/SidebarUngistered.css";

import {
  ChevronDown,
  ChevronUp,
  Folder as FolderIcon,
  MoreHorizontal,
  Search,
  Pencil,
  Palette,
  Trash2,
  ArrowRightLeft,
  Lock,
  ArrowRight,
  PanelLeftClose,
} from "lucide-react";


import newChatPng from "./newchat.png";

interface ChatSession {
  id: string;
  title: string;
}

interface ChatFolder {
  id: string;
  name: string;
  items: { id: string; title: string }[];
}

interface SidebarProps {
  sessions: ChatSession[];
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  isOpen: boolean;

  folders?: ChatFolder[];

  // optional hooks (wire to supabase later)
  onRenameFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onMoveOutOfFolder?: (folderId: string) => void;
  onCreateFolder?: () => void;

  // create folder and immediately attach current chat
  onCreateFolderAndMoveChat?: (chatId: string) => void;

  onRenameChat?: (chatId: string) => void;
  onMoveChatToFolder?: (chatId: string, folderId: string) => void;
}

export default function Sidebar({
  sessions,
  activeId,
  onSelectSession,
  onNewChat,
  onClose,
  isOpen,
  folders = [],

  onCreateFolder,
  onCreateFolderAndMoveChat,

  onRenameFolder,
  onDeleteFolder,
  onMoveOutOfFolder,

  onRenameChat,
  onMoveChatToFolder,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  // folders section collapse
  const [foldersOpen, setFoldersOpen] = useState(true);

  // collapse 
  const [openFolderIds, setOpenFolderIds] = useState<Record<string, boolean>>({});

  // menus
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chatMenu, setChatMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [moveSubmenu, setMoveSubmenu] = useState<{ chatId: string; x: number; y: number } | null>(null);

  const menuRootRef = useRef<HTMLDivElement | null>(null);

  const toggleFolderItems = (id: string) => {
    setOpenFolderIds((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders
      .map((f) => {
        const folderMatch = f.name.toLowerCase().includes(q);
        const items = f.items.filter((it) => it.title.toLowerCase().includes(q));
        if (folderMatch) return f;
        if (items.length) return { ...f, items };
        return null;
      })
      .filter(Boolean) as ChatFolder[];
  }, [folders, query]);

  // close menus on outside click / escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRootRef.current) return;
      if (menuRootRef.current.contains(e.target as Node)) return;
      setFolderMenu(null);
      setChatMenu(null);
      setMoveSubmenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFolderMenu(null);
        setChatMenu(null);
        setMoveSubmenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const openMenuAt = (setter: (v: any) => void, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setter({ id, x: rect.right + 8, y: rect.top - 6 });
  };

  const openMoveSubmenuAt = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMoveSubmenu({ chatId, x: rect.right + 8, y: rect.top - 6 });
  };

  return (
    <aside className={`av-sidebar ${isOpen ? "is-open" : ""}`}>
      <div ref={menuRootRef}>
        {/* Header */}
        <div className="av-sidebar__header">
          <div className="av-sidebar__title">Chats</div>

          <div className="av-sidebar__headerActions">
            {/* New Chat  */}
            <button className="av-iconBtn" onClick={onNewChat} title="New chat" type="button">
              <img className="av-newchatImg" src={newChatPng} alt="New chat" />
            </button>

            {/* Collapse */}
            <button className="av-iconBtn" onClick={onClose} title="Close sidebar" type="button">
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        <div className="av-divider" />

        {/* Search */}
        <div className="av-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for chats"
            aria-label="Search chats"
          />
        </div>

        <div className="av-divider" />

        {/* Chat Folders header */}
        <div className="av-sectionHeader">
          <div className="av-sectionHeader__left" onClick={() => setFoldersOpen((v) => !v)}>
            {foldersOpen ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
            <div className="av-sectionHeader__title">Chat Folders</div>
          </div>

          <button
            className="av-plusBtn"
            type="button"
            title="Add folder"
            onClick={() => onCreateFolder?.()}
          >
            +
          </button>
        </div>

        {/* Folders */}
        {foldersOpen && (
          <div className="av-folderList">
            {filteredFolders.map((folder) => {
              const expanded = openFolderIds[folder.id] ?? true;

              return (
                <div key={folder.id} className="av-folderCard">
                  <div className="av-folderCard__top">
                    <FolderIcon size={18} />
                    <div className="av-folderCard__name">{folder.name}</div>

                    {/* 3 dots */}
                    <button
                      className="av-iconBtn"
                      style={{ width: 30, height: 30, borderRadius: 10 }}
                      type="button"
                      title="Folder options"
                      onClick={(e) => {
                        setChatMenu(null);
                        setMoveSubmenu(null);
                        openMenuAt(setFolderMenu as any, folder.id, e);
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {/* collapse folder items */}
                    <button
                      className="av-iconBtn"
                      style={{ width: 30, height: 30, borderRadius: 10 }}
                      type="button"
                      title={expanded ? "Collapse" : "Expand"}
                      onClick={() => toggleFolderItems(folder.id)}
                    >
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {expanded && (
                    <div className="av-folderCard__items">
                      {folder.items.map((it) => (
                        <div
                          key={it.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => onSelectSession(it.id)}
                        >
                          {it.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="av-divider" style={{ marginTop: 14 }} />

        {/* My Chats */}
        <div className="av-sectionHeader" style={{ marginTop: 6 }}>
          <div className="av-sectionHeader__left">
            <ChevronUp size={22} />
            <div className="av-sectionHeader__title">My Chats</div>
          </div>
        </div>

        <div className="av-chatList">
          {filteredSessions.map((s) => (
            <div key={s.id} className="av-chatRow">
              <button
                type="button"
                className={`av-chatItem ${activeId === s.id ? "is-active" : ""}`}
                onClick={() => onSelectSession(s.id)}
                title={s.title}
              >
                {s.title}
              </button>

              {/* the 3 dots */}
              <button
                className="av-iconBtn"
                style={{ width: 30, height: 30, borderRadius: 10 }}
                type="button"
                title="Chat options"
                onClick={(e) => {
                  setFolderMenu(null);
                  setMoveSubmenu(null);
                  openMenuAt(setChatMenu as any, s.id, e);
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </div>

        {/* ---------- Folder Menu ---------- */}
        {folderMenu && (
          <div className="av-menu" style={{ left: folderMenu.x, top: folderMenu.y }}>
            <button
              className="av-menuItem"
              onClick={() => {
                onRenameFolder?.(folderMenu.id);
                setFolderMenu(null);
              }}
              type="button"
            >
              <Pencil size={14} />
              <span>Rename Folder</span>
              <span />
            </button>

            <div className="av-menuDivider" />

            {/*  customise is locked cus it is only available for paid */}
            <button className="av-menuItem is-locked" type="button" title="Paid feature">
              <Palette size={14} />
              <span>Customise Folder</span>
              <Lock size={14} className="av-menuRight" />
            </button>

            <div className="av-menuDivider" />

            <button
              className="av-menuItem"
              onClick={() => {
                onMoveOutOfFolder?.(folderMenu.id);
                setFolderMenu(null);
              }}
              type="button"
            >
              <ArrowRightLeft size={14} />
              <span>Move out of Folder</span>
              <span />
            </button>

            <div className="av-menuDivider" />

            <button
              className="av-menuItem"
              onClick={() => {
                onDeleteFolder?.(folderMenu.id);
                setFolderMenu(null);
              }}
              type="button"
            >
              <Trash2 size={14} />
              <span>Delete Folder</span>
              <span />
            </button>
          </div>
        )}

        {/* ---------- Chat Menu ---------- */}
        {chatMenu && (
          <div className="av-menu av-menu--chat" style={{ left: chatMenu.x, top: chatMenu.y }}>
            <button
              className="av-menuItem"
              onClick={() => {
                onRenameChat?.(chatMenu.id);
                setChatMenu(null);
              }}
              type="button"
            >
              <Pencil size={14} />
              <span>Rename Chat</span>
              <span />
            </button>

            <div className="av-menuDivider" />

            {/* customise is locked cus it is only available for paid */}
            <button className="av-menuItem is-locked" type="button" title="Paid feature">
              <Palette size={14} />
              <span>Customise Chat</span>
              <Lock size={14} className="av-menuRight" />
            </button>

            <div className="av-menuDivider" />

            <button
              className="av-menuItem"
              onClick={(e) => openMoveSubmenuAt(chatMenu.id, e)}
              type="button"
            >
              <ArrowRightLeft size={14} />
              <span>Move to a Folder</span>
              <ArrowRight size={14} className="av-menuRight" />
            </button>
          </div>
        )}

        {/* ---------- Move-to Submenu ---------- */}
        {moveSubmenu && (
          <div className="av-submenu" style={{ left: moveSubmenu.x, top: moveSubmenu.y }}>
            <button
              className="av-menuItem"
              type="button"
              onClick={() => {
                onCreateFolderAndMoveChat?.(moveSubmenu.chatId);
                setMoveSubmenu(null);
                setChatMenu(null);
              }}
            >
              <FolderIcon size={14} />
              <span>Add Folder</span>
              <span style={{ fontWeight: 700 }}>+</span>
            </button>

            <div className="av-menuDivider" />

            {folders.map((f) => (
              <button
                key={f.id}
                className="av-menuItem"
                type="button"
                onClick={() => {
                  onMoveChatToFolder?.(moveSubmenu.chatId, f.id);
                  setMoveSubmenu(null);
                  setChatMenu(null);
                }}
              >
                <FolderIcon size={14} />
                <span>{f.name}</span>
                <span />
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

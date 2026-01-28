// src/components/Sidebar/Chat_Sidebar.tsx
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

import newChatPng from "./iconsFile/newchat.png";
import CustomizePopover from "./CustomizePopover";

interface ChatSession {
  id: string;
  title: string;
  color?: string;
  emoji?: string;
}

interface ChatFolder {
  id: string;
  name: string;
  color?: string;
  emoji?: string;
  items: { id: string; title: string; color?: string; emoji?: string }[];
}

interface SidebarProps {
  paid?: boolean;

  sessions: ChatSession[];
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  isOpen: boolean;

  folders?: ChatFolder[];

  onRenameFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onMoveOutOfFolder?: (folderId: string) => void;
  onCreateFolder?: () => void;

  onCreateFolderAndMoveChat?: (chatId: string) => void;

  onRenameChat?: (chatId: string) => void;
  onMoveChatToFolder?: (chatId: string, folderId: string) => void;
  onDeleteChat?: (chatId: string) => void;

  onSaveFolderStyle?: (folderId: string, style: { color?: string; emoji?: string }) => void;
  onSaveChatStyle?: (chatId: string, style: { color?: string; emoji?: string }) => void;
}

type DraftStyle =
  | null
  | { kind: "folder"; id: string; color?: string; emoji?: string }
  | { kind: "chat"; id: string; color?: string; emoji?: string };

// ✅ customize state does NOT store x/y
type CustomizeState =
  | null
  | { kind: "folder"; id: string; current?: { color?: string; emoji?: string } }
  | { kind: "chat"; id: string; current?: { color?: string; emoji?: string } };

export default function Sidebar({
  paid = false,

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
  onDeleteChat,

  onSaveFolderStyle,
  onSaveChatStyle,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  const [foldersOpen, setFoldersOpen] = useState(true);
  const [openFolderIds, setOpenFolderIds] = useState<Record<string, boolean>>({});

  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chatMenu, setChatMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [moveSubmenu, setMoveSubmenu] = useState<{ chatId: string; x: number; y: number } | null>(null);

  const [customize, setCustomize] = useState<CustomizeState>(null);
  const [draftStyle, setDraftStyle] = useState<DraftStyle>(null);

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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRootRef.current) return;
      if (menuRootRef.current.contains(e.target as Node)) return;
      setFolderMenu(null);
      setChatMenu(null);
      setMoveSubmenu(null);
      setCustomize(null);
      setDraftStyle(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFolderMenu(null);
        setChatMenu(null);
        setMoveSubmenu(null);
        setCustomize(null);
        setDraftStyle(null);
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
    const container = menuRootRef.current?.getBoundingClientRect();
    const baseLeft = container ? rect.right - container.left : rect.right;
    const baseTop = container ? rect.top - container.top : rect.top;
    setter({ id, x: baseLeft - 2, y: baseTop + 2 });
  };

  const openMoveSubmenuAt = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const container = menuRootRef.current?.getBoundingClientRect();
    const baseLeft = container ? rect.right - container.left : rect.right;
    const baseTop = container ? rect.top - container.top : rect.top;
    setMoveSubmenu({ chatId, x: baseLeft + 4, y: baseTop + 2 });
  };

  // ✅ FIXED: no x/y here (popover positions itself)
  const openCustomizeAt = (
    kind: "folder" | "chat",
    id: string,
    current: { color?: string; emoji?: string } | undefined
  ) => {
    setCustomize({ kind, id, current });
    setDraftStyle({ kind, id, color: current?.color, emoji: current?.emoji });

    setFolderMenu(null);
    setChatMenu(null);
    setMoveSubmenu(null);
  };

  return (
    <aside className={`av-sidebar ${isOpen ? "is-open" : ""}`}>
      <div ref={menuRootRef}>
        <div className="av-sidebar__header">
          <div className="av-sidebar__title">Chats</div>

          <div className="av-sidebar__headerActions">
            <button className="av-iconBtn" onClick={onNewChat} title="New chat" type="button">
              <img className="av-newchatImg" src={newChatPng} alt="New chat" />
            </button>

            <button className="av-iconBtn" onClick={onClose} title="Close sidebar" type="button">
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        <div className="av-divider" />

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

        <div className="av-sectionHeader">
          <div className="av-sectionHeader__left" onClick={() => setFoldersOpen((v) => !v)}>
            {foldersOpen ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
            <div className="av-sectionHeader__title">Chat Folders</div>
          </div>

          <button className="av-plusBtn" type="button" title="Add folder" onClick={() => onCreateFolder?.()}>
            +
          </button>
        </div>

        {foldersOpen && (
          <div className="av-folderList">
            {filteredFolders.map((folder) => {
              const expanded = openFolderIds[folder.id] ?? true;

              const previewForFolder =
                draftStyle?.kind === "folder" && draftStyle.id === folder.id ? draftStyle : null;
              const effectiveFolderColor = previewForFolder?.color ?? folder.color;
              const effectiveFolderEmoji = previewForFolder?.emoji ?? folder.emoji;

              const folderPreviewStyle =
                paid && effectiveFolderColor ? { background: effectiveFolderColor } : undefined;
              const folderEmojiPreview = paid ? effectiveFolderEmoji : undefined;

              return (
                <div key={folder.id} className="av-folderCard">
                  <div className="av-folderCard__top">
                    <div
                      className="av-folderPill"
                      style={folderPreviewStyle}
                      onClick={() => toggleFolderItems(folder.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <FolderIcon size={18} />
                      <div className="av-folderPill__name">
                        {folderEmojiPreview ? `${folderEmojiPreview} ` : ""}
                        {folder.name}
                      </div>
                    </div>

                    <button
                      className="av-iconBtn"
                      style={{ width: 30, height: 30, borderRadius: 10 }}
                      type="button"
                      title="Folder options"
                      onClick={(e) => {
                        setChatMenu(null);
                        setMoveSubmenu(null);
                        setCustomize(null);
                        setDraftStyle(null);
                        openMenuAt(setFolderMenu as any, folder.id, e);
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>

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
                        <div key={it.id} style={{ cursor: "pointer" }} onClick={() => onSelectSession(it.id)}>
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

        <div className="av-sectionHeader" style={{ marginTop: 6 }}>
          <div className="av-sectionHeader__left">
            <ChevronUp size={22} />
            <div className="av-sectionHeader__title">My Chats</div>
          </div>
        </div>

        <div className="av-chatList">
          {filteredSessions.map((s) => {
            const previewForChat = draftStyle?.kind === "chat" && draftStyle.id === s.id ? draftStyle : null;
            const effectiveChatColor = previewForChat?.color ?? s.color;
            const effectiveChatEmoji = previewForChat?.emoji ?? s.emoji;

            return (
              <div key={s.id} className="av-chatRow">
                <button
                  type="button"
                  className={`av-chatItem ${activeId === s.id ? "is-active" : ""} ${
                    paid && effectiveChatColor ? "is-colored" : ""
                  }`}
                  style={paid && effectiveChatColor ? { background: effectiveChatColor } : undefined}
                  onClick={() => onSelectSession(s.id)}
                  title={s.title}
                >
                  {paid && effectiveChatEmoji ? `${effectiveChatEmoji} ` : ""}
                  {s.title}
                </button>

                <button
                  className="av-iconBtn"
                  style={{ width: 30, height: 30, borderRadius: 10 }}
                  type="button"
                  title="Chat options"
                  onClick={(e) => {
                    setFolderMenu(null);
                    setMoveSubmenu(null);
                    setCustomize(null);
                    setDraftStyle(null);
                    openMenuAt(setChatMenu as any, s.id, e);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Folder Menu */}
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

            {paid ? (
              <button
                className="av-menuItem"
                type="button"
                onClick={() => {
                  const f = folders.find((x) => x.id === folderMenu.id);
                  openCustomizeAt("folder", folderMenu.id, { color: f?.color, emoji: f?.emoji });
                }}
              >
                <Palette size={14} />
                <span>Customise Folder</span>
                <span />
              </button>
            ) : (
              <button className="av-menuItem is-locked" type="button" title="Paid feature">
                <Palette size={14} />
                <span>Customise Folder</span>
                <Lock size={14} className="av-menuRight" />
              </button>
            )}

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

        {/* Chat Menu */}
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

            {paid ? (
              <button
                className="av-menuItem"
                type="button"
                onClick={() => {
                  const c = sessions.find((x) => x.id === chatMenu.id);
                  openCustomizeAt("chat", chatMenu.id, { color: c?.color, emoji: c?.emoji });
                }}
              >
                <Palette size={14} />
                <span>Customise Chat</span>
                <span />
              </button>
            ) : (
              <button className="av-menuItem is-locked" type="button" title="Paid feature">
                <Palette size={14} />
                <span>Customise Chat</span>
                <Lock size={14} className="av-menuRight" />
              </button>
            )}

            <div className="av-menuDivider" />

            <button className="av-menuItem" onClick={(e) => openMoveSubmenuAt(chatMenu.id, e)} type="button">
              <ArrowRightLeft size={14} />
              <span>Move to a Folder</span>
              <ArrowRight size={14} className="av-menuRight" />
            </button>

            <div className="av-menuDivider" />

            <button
              className="av-menuItem av-menuItem--danger"
              type="button"
              onClick={() => {
                onDeleteChat?.(chatMenu.id);
                setMoveSubmenu(null);
                setChatMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>Delete Chat</span>
              <span />
            </button>
          </div>
        )}

        {/* Move-to Submenu */}
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

        {/* Customize Popover */}
        {customize && (
          <CustomizePopover
            title={customize.kind === "folder" ? "Customise Folder" : "Customise Chat"}
            defaultColor={customize.current?.color}
            defaultEmoji={customize.current?.emoji}
            onClose={() => {
              setCustomize(null);
              setDraftStyle(null);
            }}
            onChange={(payload) => {
              setDraftStyle((prev) => {
                if (!prev) return { kind: customize.kind, id: customize.id, ...payload } as any;
                if (prev.kind !== customize.kind || prev.id !== customize.id) {
                  return { kind: customize.kind, id: customize.id, ...payload } as any;
                }
                return { ...prev, ...payload } as any;
              });
            }}
            onSave={(payload) => {
              if (customize.kind === "folder") onSaveFolderStyle?.(customize.id, payload);
              else onSaveChatStyle?.(customize.id, payload);

              setCustomize(null);
              setDraftStyle(null);
            }}
          />
        )}
      </div>
    </aside>
  );
}

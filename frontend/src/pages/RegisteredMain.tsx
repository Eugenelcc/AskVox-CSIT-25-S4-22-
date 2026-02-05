import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import type { Session } from "@supabase/supabase-js";


// Components
import Background from "../components/background/background";
import ChatBar from "../components/chat/ChatBar";
import BlackHole from "../components/background/Blackhole";
import RegisteredTopBar from "../components/TopBars/RegisteredTopBar"; 
import PaidTopBar from "../components/TopBars/PaidTopBar";
import ChatMessages from "../components/chat/ChatMessages"; 
import Sidebar from "../components/Sidebar/Chat_Sidebar"; 
import NavRail from "../components/Sidebar/NavRail"; 
import "./cssfiles/registerMain.css";
import { useWakeWordBackend } from "../hooks/useWakeWordBackend";
import SettingsSidebar from "../components/Sidebar/Settings_Sidebar";
import DiscoverSidebar from "../components/Sidebar/Discover_Sidebar";
import SmartRecPanel from "../components/Sidebar/SmartRec_sidebar";
import Quiz from "../components/quiz/Quiz";

import { DiscoverView } from "../components/Discover/DiscoverView";
import NewsContent from "../components/Discover/NewsContent/NewsContent";


// Types
import type { ChatMessage, DatabaseMessage, UserProfile } from "../types/database"; 
import AccountDetails from './settings/AccountDetails';
import DeleteAccount from './settings/DeleteAccount';
import PaymentBilling from './settings/PaymentBilling';
import WakeWord from './settings/WakeWord';


// Constants 
const LLAMA_ID = 212020; 
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
type SettingsKey = "account" | "billing" | "delete" | "wakeword";
type ArticleContext = {
  title: string;
  url?: string;
  imageUrl?: string;
  description?: string;
  cached_content?: string;
  cached_at?: string;
  source_type?: string;
  publishedAt?: string;
  releasedMinutes?: number;
  all_sources?: { title: string; url: string; source: string; domain_url?: string }[];
};
type NewsContext = {
  sessionId: string | null;
  title: string;
  imageUrl?: string;
  description?: string;
  publishedAt?: string;
  releasedMinutes?: number;
  all_sources?: { title: string; url: string; source: string; domain_url?: string }[];
  path: string;
  slug: string;
  url?: string;
};


//---Quiz---//

export default function Dashboard({
  session,
  paid,
  initialTab,
}: {
  session: Session;
  paid?: boolean;
  initialTab?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSmartRecPending, setIsSmartRecPending] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  // Voice capture (reuse ChatBar approach)
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioPlayRef = useRef<HTMLAudioElement | null>(null);
  const voiceAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const hadSpeechRef = useRef(false);
  const voiceModeRef = useRef(false);
  const ttsActiveRef = useRef(false);
  const ttsSanitizeRef = useRef<((t: string) => string) | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  
  // Sidebar & Navigation State
  const [sessions, setSessions] = useState<{id: string, title: string, article_context?: ArticleContext | null}[]>([]); // all chats the user has created, shown in the sidebar
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null); // currently selected chat session
  const [activeTab, setActiveTab] = useState<string>(
    initialTab ?? (location.pathname === "/discover" ? "discover" : (location.pathname === "/newchat" ? "newchat" : "newchat"))
  ); // Tracks which tab is active in the NavRail
  const [isSidebarOpen, setSidebarOpen] = useState(false); // Sidebar visibility
  const [isNewChat, setIsNewChat] = useState(false); //When user starts a new chat
  const [newsContext, setNewsContext] = useState<NewsContext | null>(null);
  // Stores chat folders
  const [folders, setFolders] = useState<{
    id: string;   
    name: string;
    items: { id: string; title: string }[];
  }[]>([]);
  // Folder modal state
  const [isFolderModalOpen, setFolderModalOpen] = useState(false);
  const [folderModalName, setFolderModalName] = useState("");
  const [folderModalBusy, setFolderModalBusy] = useState(false);
  const [folderModalErr, setFolderModalErr] = useState<string | null>(null);
  const [folderModalForChatId, setFolderModalForChatId] = useState<string | null>(null);
  
  // Chat list in folders
  const sessionIdsInFolders = useMemo(
    () => new Set(folders.flatMap(f => f.items.map(i => i.id))),
    [folders]
  );

  // Chats not in folders
  const standaloneSessions = useMemo(
    () => sessions.filter(s => !sessionIdsInFolders.has(s.id)),
    [sessions, sessionIdsInFolders]
  );

  // Settings Sidebar
  const showSettings = isSidebarOpen && activeTab === "settings";
  const [activeSettingsKey, setActiveSettingsKey] = useState<SettingsKey | null>(null); // To track active settings section

  const handleSettingsSelect = (key: SettingsKey) => {
    setActiveSettingsKey(key);
  };

  // --- Data Fetching ---
  useEffect(() => {
    if (!session?.user?.id) return;
    
    // Fetch Profile
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data) {
          console.log("✅ Profile Loaded:", data.username); // Debug Log
          setProfile(data);
        }
      });
      
    // Fetch Sessions (most recent activity first). If 'updated_at' isn't available,
    // fall back to created_at to avoid breaking the list.
    supabase
      .from('chat_sessions')
      .select('*,display_name')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.warn('Failed to order by updated_at; falling back to created_at', error);
          supabase
            .from('chat_sessions')
            .select('*,display_name')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .then(({ data: d2 }) => d2 && setSessions(d2));
          return;
        }
        data && setSessions(data);
      });
  }, [session.user.id]);

  useEffect(() => {
    if (!activeSessionId || isNewChat) return; 

    const fetchMessages = async () => {
       const { data } = await supabase.from("chat_messages").select("*").eq("session_id", activeSessionId).order("created_at", { ascending: true });
      if (data) {
        setMessages(data.map((msg: DatabaseMessage) => ({
          id: msg.id, 
          senderId: msg.role === "user" ? session.user.id : LLAMA_ID, 
          content: msg.content, 
          createdAt: msg.created_at,
          displayName: msg.display_name, // Mapping the name from DB to UI
          meta: msg.meta ?? null,
        })));
      }
    };
    fetchMessages();
  }, [activeSessionId, isNewChat, session?.user?.id]);

  const loadFolders = async () => {
    if (!session?.user?.id) return;

    const { data, error } = await supabase
      .from("chat_folders")
      .select(`
        id,
        name,
        chat_session_folders (
          chat_sessions (
            id,
            title
          )
        )
      `)
      .eq("user_id", session.user.id);

    if (error) {
      console.error("Failed to load folders", error);
      return;
    }

    const formatted = data.map((f: any) => ({
      id: f.id,
      name: f.name,
      items: f.chat_session_folders.map((link: any) => ({
        id: link.chat_sessions.id,
        title: link.chat_sessions.title,
      })),
    }));

  setFolders(formatted);
};


  useEffect(() => {
    loadFolders();
  }, [session.user.id]);



  // --- Handlers ---

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setIsNewChat(false);
    const sess = sessions.find((s) => s.id === sessionId);
    const articleCtx = sess?.article_context;
    if (articleCtx?.title) {
      const slug = articleCtx.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'article';
      setNewsContext({
        sessionId,
        title: articleCtx.title,
        imageUrl: articleCtx.imageUrl,
        description: articleCtx.description,
        publishedAt: articleCtx.publishedAt,
        releasedMinutes: articleCtx.releasedMinutes,
        all_sources: articleCtx.all_sources,
        url: articleCtx.url,
        slug,
        path: "/discover/news",
      });
    } else if (newsContext?.sessionId && newsContext.sessionId !== sessionId) {
      setNewsContext(null);
    }
    // Keep URL in sync for deep-linking
    if (location.pathname !== `/chats/${sessionId}`) {
      navigate(`/chats/${sessionId}`);
    }
  };

  // Locally promote a session to the top of sidebar ordering.
  const promoteSessionToTop = (sid: string) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === sid);
      if (idx <= 0) return prev; // already first or not found
      const copy = prev.slice();
      const [item] = copy.splice(idx, 1);
      copy.unshift(item);
      return copy;
    });
  };

  // When we fetch a fresh list, ensure a specific session stays at the top
  const withPinnedTop = (list: {id: string; title: string}[], sid?: string | null) => {
    if (!sid) return list;
    const idx = list.findIndex(s => s.id === sid);
    if (idx <= 0) return list;
    const copy = list.slice();
    const [item] = copy.splice(idx, 1);
    copy.unshift(item);
    return copy;
  };

  const handleTabClick = (tab: string) => {
    // Keep URL in sync for Discover
    if (tab === "discover") {
      setActiveTab("discover");
      setSidebarOpen(true);
     if (!location.pathname.startsWith("/discover")) {
         navigate("/discover");
      }
      return;
    }

    // Leaving the discover route: return to the appropriate home route
    if (location.pathname === "/discover") {
      navigate(paid ? "/paiduserhome" : "/reguserhome");
    }

    // Logo click in NavRail passes "reguserhome" — treat it as home/chats
    if (tab === "reguserhome") {
      setActiveTab("chats");
      setSidebarOpen(false);
      return;
    }

    if (tab === 'newchat') {
      // Enter new chat mode, close sidebar, highlight New Chat on the rail
      handleNewChat();
      setActiveTab('newchat');
      setSidebarOpen(false);
      return;
    }
    setActiveTab(tab);
    if (tab === "settings") setActiveSettingsKey(null);
    setSidebarOpen(tab === "chats" || tab === "settings" || tab === "smartrec"|| tab === "discover");
  };


  const handleNewChat = async () => {
    // Clear UI only; DO NOT create a session yet.
    // A new chat_session will be created lazily on first send.
    // For voice mode we now persist per turn, no batch save on exit
    setActiveSessionId(null);
    setIsNewChat(true);
    // Exit voice mode and stop any active audio/recording
    voiceModeRef.current = false;
    setIsVoiceMode(false);
    ttsActiveRef.current = false;
    setIsTtsPlaying(false);
    voiceSessionIdRef.current = null;
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {}
    mediaRecorderRef.current = null;
    setIsRecording(false);
    try {
      audioPlayRef.current?.pause();
    } catch {}
    audioPlayRef.current = null;
    try {
      voiceAnalyserRef.current?.disconnect();
      voiceSourceRef.current?.disconnect();
      voiceAudioCtxRef.current?.close();
    } catch {}
    voiceAnalyserRef.current = null;
    voiceSourceRef.current = null;
    voiceAudioCtxRef.current = null;
    // Finally clear messages after teardown
    setMessages([]);
    // Navigate to the canonical New Chat route
    if (location.pathname !== "/newchat") {
      navigate("/newchat");
    }
  };

  const handleMoveChatToFolder = async (chatId: string, folderId: string) => {
    const { error } = await supabase.from("chat_session_folders").upsert({
      session_id: chatId,
      folder_id: folderId,
    });

    if (error) {
      console.error("Failed to move chat to folder", error);
      return;
    }

    // 🔁 refresh folders after move
    await loadFolders();

    const { data: allSessions } = await supabase
      .from("chat_sessions")
      .select("id, title, article_context")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (allSessions) setSessions(allSessions);
  };

   const handleRenameChat = async (chatId: string) => {
  const sess = sessions.find((s) => s.id === chatId);
  const next = window.prompt("Rename chat:", sess?.title ?? "");
  if (!next?.trim()) return;

  const { error } = await supabase
    .from("chat_sessions")
    .update({ title: next.trim(), updated_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("Failed to rename chat", error);
    return;
  }

  // refresh list
  const { data: allSessions } = await supabase
    .from("chat_sessions")
    .select("id, title, article_context")
    .eq("user_id", session.user.id)
    .order("updated_at", { ascending: false });

  if (allSessions) setSessions(allSessions);
};

  const handleDeleteChat = async (chatId: string) => {
    try {
      // Attempt to remove folder links first (ignore errors if table doesn't exist or RLS blocks)
      try {
        await supabase.from("chat_session_folders").delete().eq("session_id", chatId);
      } catch {}    //TEST

      // Delete the chat session (scoped to user for safety)
      const { error } = await supabase
        .from("chat_sessions")
        .delete()
        .eq("id", chatId)
        .eq("user_id", session.user.id);
      if (error) throw error;

      // Update UI state
      setSessions(prev => prev.filter(s => s.id !== chatId));
      if (activeSessionId === chatId) {
        setActiveSessionId(null);
        setMessages([]);
        setIsNewChat(true);
        setActiveTab("newchat");
        setSidebarOpen(false);
        if (location.pathname !== "/newchat") navigate("/newchat");
      }
    } catch (e) {
      console.error("Failed to delete chat", e);
      alert("Unable to delete chat. Please try again.");
    }
  };

  // Reload messages from Supabase for the given session
  const refreshActiveSessionMessages = async (sessionId?: string | null) => {
    try {
      const sid = sessionId ?? activeSessionId;
      if (!sid) return;
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sid)
        .order("created_at", { ascending: true });
      if (data) {
        const mapped = data.map((msg: DatabaseMessage) => ({
          id: msg.id,
          senderId: msg.role === "user" ? session.user.id : LLAMA_ID,
          content: msg.content,
          createdAt: msg.created_at,
          displayName: msg.display_name,
          meta: msg.meta ?? null,
        }));
        setMessages(mapped);
        return mapped;
      }
    } catch (e) {
      console.warn("Failed to refresh chat messages after voice mode", e);
    }
    return null;
  };

  // SmartRec: poll until assistant reply arrives (backend inserts it asynchronously)
  useEffect(() => {
    if (!isSmartRecPending || !activeSessionId || isNewChat) return;

    let cancelled = false;
    let handle: number | null = null;
    let attempts = 0;
    const maxAttempts = 45; // ~45 seconds

    const tick = async () => {
      attempts += 1;
      const currentSid = activeSessionId;
      const mapped = await refreshActiveSessionMessages(currentSid);
      if (cancelled) return;

      const last = mapped && mapped.length ? mapped[mapped.length - 1] : null;
      if (last && last.senderId === LLAMA_ID && String(last.content || "").trim()) {
        setIsSmartRecPending(false);
        return;
      }

      if (attempts >= maxAttempts) {
        setIsSmartRecPending(false);
        return;
      }

      handle = window.setTimeout(tick, 1000);
    };

    // Short delay to allow the just-inserted user message to appear
    handle = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      if (handle) window.clearTimeout(handle);
    };
  }, [isSmartRecPending, activeSessionId, isNewChat]);

  // Keep component state in sync with /newchat and /chats/:sessionId
  useEffect(() => {
    const path = location.pathname;
    if (path === "/newchat") {
      setIsNewChat(true);
      setActiveSessionId(null);
      setActiveTab("newchat");
      setSidebarOpen(false);
      setMessages([]);
      return;
    }
    const match = path.match(/^\/chats\/([a-f0-9\-]+)$/i);
    if (match) {
      const sid = match[1];
      setIsNewChat(false);
      setActiveSessionId(sid);
      setActiveTab("chats");
      setSidebarOpen(true);
      void refreshActiveSessionMessages(sid);
    }
  }, [location.pathname]);


  const handleSubmit = async (
    text: string,
    options?: { forceNewSession?: boolean; context?: ArticleContext }
  ): Promise<string | null> => {
    const trimmed = text.trim();
    if (!trimmed || !session?.user?.id) return null;
    console.log("💬 [Text] route=llamachats/cloud payload=", trimmed);

    // If user starts typing/sending, stop SmartRec pending indicator.
    if (isSmartRecPending) setIsSmartRecPending(false);

    // 1. Determine Session ID
    let currentSessionId = options?.forceNewSession ? null : activeSessionId;
    const createdSession = !currentSessionId;
    if (!currentSessionId) {
      // Block initial fetch until we finish first-write
      setIsNewChat(true);
      // ✅ Create ONE new chat session
      const { data: newSession, error } = await supabase
        .from('chat_sessions')
        .insert({
          user_id: session.user.id,
          title: options?.context?.title
            ? options.context.title.slice(0, 60)
            : trimmed.slice(0, 30) + '...',
          article_context: options?.context?.title
            ? {
                ...options.context,
                source_type: "news_article",
                cached_content: options.context.description || "",
                cached_at: new Date().toISOString(),
              }
            : null,
        })
        .select()
        .single();

      if (error || !newSession) {
        console.error('Failed to create chat session', error);
        return null;
      }

      currentSessionId = newSession.id;
      setActiveSessionId(currentSessionId);

      // ✅ Refresh sidebar sessions from DB
      const { data: allSessions } = await supabase
        .from('chat_sessions')
        .select('id, title, article_context')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false });

      if (allSessions) setSessions(allSessions);
    }

    // 2. Prepare Name
    const userName = profile?.username || "User"; 
    console.log("📝 Sending Message as:", userName); // Debug Log

    // 3. Optimistic Update (Show on screen immediately)
    setMessages(prev => [...prev, { 
      id: `temp-${Date.now()}`, 
      senderId: session.user.id, 
      content: trimmed, 
      createdAt: new Date().toISOString(),
      displayName: userName 
    }]);
    
    setIsSending(true);

    const queryId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

    // Domain classify (best-effort). If backend is down, default to "general".
    let detectedDomain = "general";
    try {
      const dres = await fetch(`${API_BASE_URL}/domain/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, include_debug: true }),
      });
      if (dres.ok) {
        const djson = await dres.json().catch(() => null);
        if (djson?.domain && typeof djson.domain === "string") {
          detectedDomain = djson.domain;
        }

        // Debug: what Google NLP returned vs what we store in Supabase
        if (djson?.google_top_category || djson?.strategy) {
          console.log("[domain]", {
            text: trimmed,
            google_top_category: djson.google_top_category,
            google_top_confidence: djson.google_top_confidence,
            strategy: djson.strategy,
            mapped_domain: djson.domain,
          });
        }
      }
    } catch {
      // ignore; keep default
    }

    console.log("[supabase] inserting query detected_domain", {
      queryId,
      detectedDomain,
      text: trimmed,
    });

    // Backend-terminal debug log of exactly what we will insert into Supabase.
    // This is best-effort and will be ignored if the backend has debug logging disabled.
    try {
      await fetch(`${API_BASE_URL}/domain/debug-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "queries",
          payload: {
            id: queryId,
            session_id: currentSessionId,
            user_id: session.user.id,
            input_mode: "text",
            transcribed_text: trimmed,
            detected_domain: detectedDomain,
          },
        }),
      });
    } catch {
      // ignore
    }

    await supabase.from("queries").insert({
      id: queryId,
      session_id: currentSessionId,
      user_id: session.user.id,
      input_mode: "text",
      transcribed_text: trimmed,
      detected_domain: detectedDomain,
    });

    
    // 4. Save USER message to Supabase (await to avoid race with initial fetch)
    await supabase.from('chat_messages').insert({ 
      session_id: currentSessionId, 
      user_id: session.user.id, 
      role: 'user', 
      content: trimmed,
      display_name: userName // <--- CRITICAL: Sending the name here
    });

    // Immediately promote locally so the UI reflects recency without waiting
    if (currentSessionId) promoteSessionToTop(currentSessionId);

    // 4b. Bump session activity timestamp so it floats to the top
    try {
      await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentSessionId);
      // Refresh sidebar ordering
      const { data: allSessions } = await supabase
        .from('chat_sessions')
        .select('id, title')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false });
      if (allSessions && allSessions.length) {
        setSessions(withPinnedTop(allSessions, currentSessionId));
      } else if (currentSessionId) {
        promoteSessionToTop(currentSessionId);
      }
    } catch (e) {
      console.warn('Failed to update session activity timestamp', e);
      // As a UI fallback, at least move the session up locally
      if (currentSessionId) promoteSessionToTop(currentSessionId);
    }

    // If we just created the session, now mark new-chat as false so fetch will include this message
    if (createdSession) setIsNewChat(false);

    try {
      const activeContext = options?.context?.title
        ? options.context
        : (newsContext && newsContext.sessionId === currentSessionId
          ? {
              title: newsContext.title,
              url: newsContext.url,
              imageUrl: newsContext.imageUrl,
              description: newsContext.description,
              publishedAt: newsContext.publishedAt,
              releasedMinutes: newsContext.releasedMinutes,
              all_sources: newsContext.all_sources,
            }
          : undefined);
      const modelMessage = activeContext?.title
        ? `Regarding the article "${activeContext.title}", ${trimmed}`
        : trimmed;
      const llamaPayload = {
        message: modelMessage,
        history: [
          ...messages.map(m => ({
            role: m.senderId === session.user.id ? "user" : "assistant",
            content: m.content,
          })),
          { role: "user", content: modelMessage },
        ],
        query_id: queryId,
        session_id: currentSessionId,
        user_id: session.user.id,
        article_title: activeContext?.title || null,
        article_url: activeContext?.url || null,
      };
      console.log("🧪 [LLAMA] payload:", llamaPayload);
      const llamaStart = performance.now();
      console.time("llama_request_ms");
      // 5. Call AI API
      const response = await fetch(`${API_BASE_URL}/llamachats-multi/cloud_plus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(llamaPayload)
      });

      const llamaEnd = performance.now();
      console.timeEnd("llama_request_ms");
      console.log("🧪 [LLAMA] status:", response.status, "elapsed_ms:", Math.round(llamaEnd - llamaStart));

      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ AI API error:", response.status, response.statusText, errorText);
        setIsSending(false);
        return null;
      }

      const data = await response.json();
      console.log("🤖 AI Response Data:", data); // Debug Log

      // Handle different API response formats
      const replyText = data.answer || data.response || data.reply || ""; 
      const meta = data.payload || null;

      // Guard against empty responses (Prevents the "Dots" issue)
      if (!replyText) {
        console.warn("⚠️ Empty response from AI. Not saving.");
        setIsSending(false);
        return null;
      }
      
      setIsSending(false);
      

      const streamId = `llama-${Date.now()}`;
      setMessages(prev => [...prev, { 
        id: streamId, 
        senderId: LLAMA_ID, 
        content: replyText, 
        createdAt: new Date().toISOString(),
        displayName: "AskVox",
        meta,
      }]);

    } catch (err) { 
       console.error("❌ Error sending message:", err);
       setIsSending(false); 
    }
    return currentSessionId;
  };

  const handleNewsQuestion = async (
    question: string,
    article: {
      title: string;
      imageUrl?: string;
      description?: string;
      publishedAt?: string;
      releasedMinutes?: number;
      all_sources?: { title: string; url: string; source: string; domain_url?: string }[];
      url?: string;
      slug: string;
      path: string;
    }
  ) => {
    setActiveTab("chats");
    setSidebarOpen(true);
    if (location.pathname.startsWith("/discover")) {
      navigate(paid ? "/paiduserhome" : "/reguserhome");
    }
    setActiveSessionId(null);
    setIsNewChat(true);

    setNewsContext({
      sessionId: null,
      title: article.title,
      imageUrl: article.imageUrl,
      description: article.description,
      publishedAt: article.publishedAt,
      releasedMinutes: article.releasedMinutes,
      all_sources: article.all_sources,
      url: article.url,
      slug: article.slug,
      path: article.path,
    });

    const sessionId = await handleSubmit(question, {
      forceNewSession: true,
      context: {
        title: article.title,
        url: article.url,
        imageUrl: article.imageUrl,
        description: article.description,
        publishedAt: article.publishedAt,
        releasedMinutes: article.releasedMinutes,
        all_sources: article.all_sources,
      },
    });

    setNewsContext({
      sessionId: sessionId ?? null,
      title: article.title,
      imageUrl: article.imageUrl,
      description: article.description,
      publishedAt: article.publishedAt,
      releasedMinutes: article.releasedMinutes,
      all_sources: article.all_sources,
      url: article.url,
      slug: article.slug,
      path: article.path,
    });
  };

  const showSidebar = isSidebarOpen && activeTab === 'chats';
  const showSmartRec = isSidebarOpen && activeTab === "smartrec";
  const showDiscover = isSidebarOpen && activeTab === "discover";
  const [discoverCategory, setDiscoverCategory] = useState<string | null>(null);
  const isBlackHoleActive = isVoiceMode && (isRecording || isTranscribing || isTtsPlaying);

  // ---- Voice Mode (wake -> voice-only flow) ----
  const cleanTextForTTS = (text: string) => {
    try {
      let t = text ?? "";
      // Strip code fences and inline code
      t = t.replace(/```[\s\S]*?```/g, " ");
      t = t.replace(/`([^`]+)`/g, "$1");
      // Convert Markdown links [text](url) -> text
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
      // Remove bold/italic markers *, _, ~, #, >
      t = t.replace(/[\*#_~>]+/g, "");
      // Drop citations like [1], [^note]
      t = t.replace(/\[[^\]]*\]/g, "");
      // Normalize bullet lines
      t = t.replace(/^\s*[-•\d+\.)]+\s+/gm, "");
      // Collapse excessive whitespace and punctuation
      t = t.replace(/[\s\u00A0]+/g, " ").trim();
      t = t.replace(/([,.!?])\1+/g, "$1");
      // Prevent TTS from reading stray symbols
      t = t.replace(/[\u2000-\u206F]/g, "");
      return t;
    } catch {
      return text ?? "";
    }
  };
  ttsSanitizeRef.current = cleanTextForTTS;

  // Keep a ref in sync with isVoiceMode to avoid stale-closure bugs
  useEffect(() => {
    voiceModeRef.current = isVoiceMode;
  }, [isVoiceMode]);

  // Removed local beep/speech confirmation; using Google TTS for consistency
  const speakWithGoogleTTS = async (text: string, rearmAfterPlayback: boolean = true) => {
    try {
      const safeText = (ttsSanitizeRef.current?.(text)) ?? text;
      console.log("🔊 [TTS] requesting playback for:", safeText);
      // Mark TTS active BEFORE stopping recorder to avoid re-arm race in onstop
      ttsActiveRef.current = true;
      setIsTtsPlaying(true);
      // Request MP3 audio from backend
      const res = await fetch(`${API_BASE_URL}/tts/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: safeText, language_code: "en-US" }),
      });
      if (!res.ok) { console.error("TTS request failed"); setIsTtsPlaying(false); ttsActiveRef.current = false; return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Stop any current playback
      if (audioPlayRef.current) { try { audioPlayRef.current.pause(); } catch {} }
      // Stop active recording to avoid feedback while TTS plays
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
          try { setIsRecording(false); } catch {}
        }
      } catch {}
      const audio = new Audio(url);
      audio.preload = "auto";
      audioPlayRef.current = audio;
      try {
        await audio.play(); // resolves when playback starts, not ends
        console.log("🔊 [TTS] playback started");
      } catch (e) {
        console.warn("🔊 [TTS] playback blocked or failed, fallback to immediate listen", e);
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        setIsTtsPlaying(false);
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 150);
        }
        return;
      }
      const restart = () => {
        console.log("🔊 [TTS] playback ended, starting to listen");
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        setIsTtsPlaying(false);
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 200);
        }
      };
      const fail = (err?: any) => {
        console.warn("🔊 [TTS] playback error or stalled, restarting listen", err);
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        setIsTtsPlaying(false);
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 300);
        }
      };
      audio.addEventListener("ended", restart, { once: true });
      audio.addEventListener("error", fail, { once: true });
      // Fallback timer in case 'ended' doesn't fire
      const fallbackMs = 30000; // 30s safety
      const timerId = window.setTimeout(() => fail("fallback-timeout"), fallbackMs);
      // Clear timer on cleanup
      audio.addEventListener("ended", () => window.clearTimeout(timerId), { once: true });
      audio.addEventListener("error", () => window.clearTimeout(timerId), { once: true });
      // Wait until playback finishes or errors to resolve
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        audio.addEventListener("ended", done, { once: true });
        audio.addEventListener("error", done, { once: true });
      });
    } catch (e) {
      console.error("Error playing TTS audio", e);
      ttsActiveRef.current = false;
      setIsTtsPlaying(false);
      if (voiceModeRef.current) { setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 200); }
    }
  };

  const startVoiceRecording = async () => {
    if (isRecording || !voiceModeRef.current || ttsActiveRef.current) return;
    console.log("🎙️  [VoiceMode] startVoiceRecording() called");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
        } as MediaTrackConstraints,
      });
      console.log("🎙️  [VoiceMode] mic stream acquired");
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // Ensure flags and refs reset on any stop (silence or manual)
        try { setIsRecording(false); } catch {}
        mediaRecorderRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        try {
          voiceAnalyserRef.current?.disconnect();
          voiceSourceRef.current?.disconnect();
          await voiceAudioCtxRef.current?.close();
        } catch {}
        voiceAnalyserRef.current = null;
        voiceSourceRef.current = null;
        voiceAudioCtxRef.current = null;
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        try {
          setIsTranscribing(true);
          const formData = new FormData();
          formData.append("file", audioBlob, "utterance.webm");

          const sttRes = await fetch(`${API_BASE_URL}/stt/`, { method: "POST", body: formData });
          if (!sttRes.ok) { console.error("STT request failed"); return; }
          const sttData = await sttRes.json();
          const transcript: string = sttData.text ?? "";
          if (transcript) {
            console.log("🎙️  [VoiceMode STT] transcript:", transcript);
          }

          if (transcript) {
            // Exit phrase to leave voice mode safely
            const tnorm = transcript.toLowerCase();
            if (
              tnorm.includes("stop listening") ||
              tnorm.includes("goodbye") ||
              tnorm.includes("bye") ||
              tnorm.includes("end")
            ) {
              exitVoiceMode();
              return;
            }

            // Ensure there is a chat session (create lazily on first voice turn)
            // Force NEW session when user initiated 'New Chat' before wake.
            let currentSessionId = voiceSessionIdRef.current ?? (isNewChat ? null : activeSessionId);
            if (!currentSessionId) {
              const { data: newSession, error: sessErr } = await supabase
                .from('chat_sessions')
                .insert({
                  user_id: session.user.id,
                  title: transcript.slice(0, 30) + '...',
                })
                .select()
                .single();
              if (sessErr || !newSession?.id) {
                console.error('Failed to create chat session for voice mode', sessErr);
              } else {
                currentSessionId = newSession.id;
                voiceSessionIdRef.current = currentSessionId;
                setActiveSessionId(currentSessionId);
                setIsNewChat(false);
                // Refresh sidebar sessions list
                try {
                  const { data: allSessions } = await supabase
                    .from('chat_sessions')
                    .select('id, title, article_context')
                    .eq('user_id', session.user.id)
                    .order('updated_at', { ascending: false });
                  if (allSessions && allSessions.length) {
                    setSessions(withPinnedTop(allSessions, currentSessionId));
                  } else if (currentSessionId) {
                    promoteSessionToTop(currentSessionId);
                  }
                } catch {}
              }
            }

            // Append user's utterance to history for contextual turns
            const userMsgId = globalThis.crypto?.randomUUID?.() ?? `vuser-${Date.now()}-${Math.random()}`;
            setMessages(prev => [
              ...prev,
              {
                id: userMsgId,
                senderId: session.user.id,
                content: transcript,
                createdAt: new Date().toISOString(),
                displayName: profile?.username ?? "User",
              },
            ]);

            // Save USER message to Supabase immediately
            if (currentSessionId) {
              try {
                await supabase.from('chat_messages').insert({
                  session_id: currentSessionId,
                  user_id: session.user.id,
                  role: 'user',
                  content: transcript,
                  display_name: profile?.username ?? 'User',
                });
                // Promote locally right away
                promoteSessionToTop(currentSessionId);
                // Bump session activity and refresh list ordering
                try {
                  await supabase
                    .from('chat_sessions')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('id', currentSessionId);
                  const { data: allSessions } = await supabase
                    .from('chat_sessions')
                    .select('id, title')
                    .eq('user_id', session.user.id)
                    .order('updated_at', { ascending: false });
                  if (allSessions && allSessions.length) {
                    setSessions(withPinnedTop(allSessions, currentSessionId));
                  } else {
                    promoteSessionToTop(currentSessionId);
                  }
                } catch (e) {
                  console.warn('Failed to update session activity timestamp (voice)', e);
                  promoteSessionToTop(currentSessionId);
                }
              } catch (e) {
                console.warn('Failed to insert user voice chat_message', e);
              }
            }

            // Create a query row (Voice) now so backend can attach response
            const queryId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
            try {
              // Domain classify (best-effort)
              let detectedDomainVoice = "general";
              try {
                const dres = await fetch(`${API_BASE_URL}/domain/classify`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: transcript, include_debug: true }),
                });
                if (dres.ok) {
                  const djson = await dres.json().catch(() => null);
                  if (djson?.domain && typeof djson.domain === "string") {
                    detectedDomainVoice = djson.domain;
                  }

                  if (djson?.google_top_category || djson?.strategy) {
                    console.log("[domain][voice]", {
                      text: transcript,
                      google_top_category: djson.google_top_category,
                      google_top_confidence: djson.google_top_confidence,
                      strategy: djson.strategy,
                      mapped_domain: djson.domain,
                    });
                  }
                }
              } catch {
                // ignore; keep default
              }

              // Backend-terminal debug log of exactly what we will insert into Supabase.
              // This is best-effort and will be ignored if the backend has debug logging disabled.
              try {
                await fetch(`${API_BASE_URL}/domain/debug-log`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    table: "queries",
                    payload: {
                      id: queryId,
                      session_id: currentSessionId,
                      user_id: session.user.id,
                      input_mode: "voice",
                      transcribed_text: transcript,
                      detected_domain: detectedDomainVoice,
                    },
                  }),
                });
              } catch {
                // ignore
              }

              await supabase.from('queries').insert({
                id: queryId,
                session_id: currentSessionId,
                user_id: session.user.id,
                input_mode: 'voice',
                transcribed_text: transcript,
                detected_domain: detectedDomainVoice,
              });
            } catch (e) {
              console.warn('Failed to insert voice query', e);
            }

            // Send to Sealion (server should route to SeaLion model), pass query linkage
            console.log("🌊 [VoiceMode] route=sealionchats payload=", transcript);
            const sealionRes = await fetch(`${API_BASE_URL}/geminichats/`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: transcript,
                history: messages.map(m => ({
                  role: m.senderId === session.user.id ? "user" : "assistant",
                  content: m.content,
                })),
                query_id: queryId,
                session_id: currentSessionId,
                user_id: session.user.id,
              }),
            });
            const sealionData = await sealionRes.json();
            const replyText = sealionData.answer || sealionData.response || sealionData.reply || "";
            if (replyText) {
              // Append assistant reply to history to keep context growing
              const botMsgId = globalThis.crypto?.randomUUID?.() ?? `vbot-${Date.now()}-${Math.random()}`;
              setMessages(prev => [
                ...prev,
                {
                  id: botMsgId,
                  senderId: LLAMA_ID,
                  content: replyText,
                  createdAt: new Date().toISOString(),
                  displayName: "AskVox",
                },
              ]);
              // Fire TTS and let it handle re-arming on 'ended'
              void speakWithGoogleTTS(replyText);
            } else {
              // No reply; resume listening so the loop continues
              if (voiceModeRef.current) { setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 250); }
            }
          }
        } catch (err) {
          console.error("Error in voice mode STT/Sealion flow", err);
          // On error, resume listening to avoid getting stuck
          if (voiceModeRef.current) { setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 400); }
        } finally {
          setIsTranscribing(false);
          // Ensure we always re-arm the mic if still in voice mode
          if (voiceModeRef.current && !ttsActiveRef.current) {
            setTimeout(() => {
              if (voiceModeRef.current && (!audioPlayRef.current || audioPlayRef.current.paused)) {
                void startVoiceRecording();
              }
            }, 300);
          }
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);

      // Silence detection (stop after ~1.2s of silence, with an 10s cap)
      const audioCtx = new AudioContext();
      try { await audioCtx.resume(); } catch {}
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      voiceAudioCtxRef.current = audioCtx;
      voiceAnalyserRef.current = analyser;
      voiceSourceRef.current = source;

      const buf = new Float32Array(analyser.fftSize);
      const silenceThreshold = 0.008; // ~-42 dBFS
      const silenceHoldMs = 1200;
      const hardCapMs = 10000;
      let lastVoiceAt = Date.now();
      hadSpeechRef.current = false;

      const tick = () => {
        if (!voiceAnalyserRef.current || !mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms >= silenceThreshold) {
          lastVoiceAt = now;
          hadSpeechRef.current = true;
        }
        // Stop when we have speech and then sustained silence
        if (hadSpeechRef.current && now - lastVoiceAt >= silenceHoldMs) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          mediaRecorderRef.current = null;
          setIsRecording(false);
          return;
        }
        // Hard cap to avoid runaway
        if (now - (audioCtx as any).startTimeMs >= hardCapMs) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          mediaRecorderRef.current = null;
          setIsRecording(false);
          return;
        }
        requestAnimationFrame(tick);
      };
   
      (audioCtx as any).startTimeMs = Date.now();
      requestAnimationFrame(tick);
    } catch (err) {
      console.error("Error accessing microphone (voice mode)", err);
      setIsRecording(false);
    }
  };

  const enterVoiceMode = () => {
    // Hide chat UI; show BlackHole only
    setIsVoiceMode(true);
    voiceModeRef.current = true;
    voiceSessionIdRef.current = null;
    // No chatbar, no messages list during voice mode
    setActiveSessionId(null);
    setIsNewChat(true);
    // Close sidebar for focused voice mode
    setSidebarOpen(false);
    // Speak confirmation via Google TTS, then re-arm mic after playback ends
    void speakWithGoogleTTS("AskVox is listening", true);
  };

  const exitVoiceMode = () => {
    voiceModeRef.current = false;
    setIsVoiceMode(false);
    setIsNewChat(false);
    setIsTtsPlaying(false);
    try { (window as any).speechSynthesis?.cancel?.(); } catch {}
    // Stop recorder and playback when exiting
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {}
    mediaRecorderRef.current = null;
    setIsRecording(false);
    try { audioPlayRef.current?.pause(); } catch {}
    audioPlayRef.current = null;
    try {
      voiceAnalyserRef.current?.disconnect();
      voiceSourceRef.current?.disconnect();
      voiceAudioCtxRef.current?.close();
    } catch {}
    voiceAnalyserRef.current = null;
    voiceSourceRef.current = null;
    voiceAudioCtxRef.current = null;
    // Ensure UI shows any final DB writes (e.g., first voice turn).
    // Use the latest known session id to avoid race with state updates.
    const sid = voiceSessionIdRef.current || activeSessionId;
    // Promote the session back to the UI.
    if (sid) {
      setActiveSessionId(sid);
      window.setTimeout(() => { void refreshActiveSessionMessages(sid); }, 120);
    }
    // Clear the voice-mode session ref after we've captured sid.
    voiceSessionIdRef.current = null;
  };

  // Wake detection: when wake triggers, enter voice mode
  useWakeWordBackend({
    enabled: !isVoiceMode,
    onWake: enterVoiceMode,
  });

  const openCreateFolderModal = (chatId: string | null = null) => {
    setFolderModalErr(null);
    setFolderModalName("");
    setFolderModalForChatId(chatId);
    setFolderModalOpen(true);
  };

  const handleCreateFolder = async () => {
    openCreateFolderModal(null);
  };

  const handleRenameFolder = async (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    const nextName = window.prompt("Rename folder:", folder?.name ?? "");
    if (!nextName?.trim()) return;
  
    const { error } = await supabase
      .from("chat_folders")
      .update({ name: nextName.trim() })
      .eq("id", folderId)
      .eq("user_id", session.user.id);
  
    if (error) {
      console.error("Failed to rename folder", error);
      return;
    }
  
    await loadFolders();
  };

  const handleDeleteFolder = async (folderId: string) => {
    const ok = window.confirm("Delete this folder? Chats will NOT be deleted.");
    if (!ok) return;
  
    // 1) delete join links first
    const { error: linkErr } = await supabase
      .from("chat_session_folders")
      .delete()
      .eq("folder_id", folderId);
  
    if (linkErr) {
      console.error("Failed to remove folder links", linkErr);
      return;
    }
  
    // 2) delete folder
    const { error } = await supabase
      .from("chat_folders")
      .delete()
      .eq("id", folderId)
      .eq("user_id", session.user.id);
  
    if (error) {
      console.error("Failed to delete folder", error);
      return;
    }
  
    await loadFolders();
  };

  const handleMoveOutOfFolder = async (folderId: string) => {
    // removes all chats from that folder
    const { error } = await supabase
      .from("chat_session_folders")
      .delete()
      .eq("folder_id", folderId);
  
    if (error) {
      console.error("Failed to move chats out of folder", error);
      return;
    }
  
    await loadFolders();
  };

  const handleCreateFolderAndMoveChat = async (chatId: string) => {
    openCreateFolderModal(chatId);
  };

  const confirmCreateFolder = async () => {
    const name = folderModalName.trim();
    if (!name) {
      setFolderModalErr("Please enter a folder name.");
      return;
    }
    setFolderModalBusy(true);
    setFolderModalErr(null);
    try {
      // Create folder
      const { data: folder, error: folderErr } = await supabase
        .from("chat_folders")
        .insert({ user_id: session.user.id, name })
        .select()
        .single();
      if (folderErr || !folder) {
        throw folderErr || new Error("Failed to create folder");
      }
      // Optionally link a chat
      if (folderModalForChatId) {
        const { error: linkErr } = await supabase
          .from("chat_session_folders")
          .insert({ session_id: folderModalForChatId, folder_id: folder.id });
        if (linkErr) throw linkErr;
      }
      await loadFolders();
      setFolderModalOpen(false);
      setFolderModalName("");
      setFolderModalForChatId(null);
    } catch (e: any) {
      console.error("Failed to create folder", e);
      setFolderModalErr(e?.message || "Failed to create folder");
    } finally {
      setFolderModalBusy(false);
    }
  };

  
  
  
  

  // compute content offset so both the main content and the fixed chatbar
  // can stay in sync when sidebars open/close
  const navRailWidth = 80; // fixed rail width (matches NavRail)
  // Left sidebars configuration (positions must match CSS)
  const leftOffset = 110; // matches .av-settings/.av-sidebar { left: 110px; }
  const widths = {
    discover: 310, // Settings/Discover sidebar width
    settings: 310,
    chats: 368,    // Chat sidebar width
  } as const;

  const viewingArticle = location.pathname.startsWith("/discover/news");
  const discoverOpen = isSidebarOpen && (activeTab === "discover" || viewingArticle);
  const chatsOpen = isSidebarOpen && activeTab === "chats";
  const settingsOpen = isSidebarOpen && activeTab === "settings";

  const contentMarginLeft = discoverOpen
    ? `${leftOffset + widths.discover}px`
    : settingsOpen
    ? `${leftOffset + widths.settings}px`
    : chatsOpen
    ? `${leftOffset + widths.chats}px`
    : `${navRailWidth}px`;

  return (
    <div className="uv-root" style={{ display: 'flex', overflowX: 'hidden', ['--content-offset' as any]: contentMarginLeft }}>
      <Background />
      
      <NavRail
        activeTab={activeTab}
        onTabClick={handleTabClick}
        onOpenSidebar={(tab) => setSidebarOpen(tab === "chats" || tab === "settings" || tab === "smartrec" || tab === "discover")}
        avatarPath={profile?.avatar_url ?? "defaults/default.png"}
      />


      <Sidebar
        paid={paid}
        sessions={standaloneSessions}
        folders={folders}
        activeId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={() => { handleNewChat(); setActiveTab('newchat'); setSidebarOpen(false); }}
        onClose={() => setSidebarOpen(false)}
        isOpen={showSidebar}
        onMoveChatToFolder={handleMoveChatToFolder}
        onCreateFolder={handleCreateFolder}
        onCreateFolderAndMoveChat={handleCreateFolderAndMoveChat}
        onRenameFolder={handleRenameFolder}
        onRenameChat={handleRenameChat}
        onDeleteFolder={handleDeleteFolder}
        onMoveOutOfFolder={handleMoveOutOfFolder}
        onDeleteChat={handleDeleteChat}

           // ✅ add these so paid customise can save (you can implement later)
        onSaveFolderStyle={(folderId, style) => console.log("save folder style", folderId, style)}
        onSaveChatStyle={(chatId, style) => console.log("save chat style", chatId, style)}

      />

      <SettingsSidebar
        isOpen={showSettings}
        activeKey={activeSettingsKey}
        onSelect={handleSettingsSelect}
        onClose={() => setSidebarOpen(false)}
      />
      <DiscoverSidebar
        isOpen={showDiscover}
        onClose={() => setSidebarOpen(false)}
        onCategorySelect={(c) => {
          setDiscoverCategory(c);
          setActiveTab("discover");
          setSidebarOpen(false);
          if (location.pathname !== "/discover") navigate("/discover");
        }}
      />
      {/* ✅ SmartRec sidebar overlay */}
      {showSmartRec && (
        <div className="sr-overlay">
          <SmartRecPanel
            userId={session.user.id}
            onOpenSession={(sid, pendingReply) => {
              setActiveTab("chats");
              setSidebarOpen(true);
              setActiveSessionId(sid);
              setIsNewChat(false);
              setMessages([]);
              setIsSmartRecPending(!!pendingReply);
              window.setTimeout(() => {
                void refreshActiveSessionMessages(sid);
              }, 80);
            }}
          />
        </div>
      )}


      <div style={{
            flex: 1,
            marginLeft: contentMarginLeft,
            transition: 'margin-left 250ms ease',
            position: 'relative',
            width: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}>
        
        {paid ? <PaidTopBar session={session} /> : <RegisteredTopBar session={session} />}

        <main className="uv-main">
          {/* SETTINGS MODE */}
          {activeTab === "settings" ? (
            activeSettingsKey === "account" ? (
              <AccountDetails session={session} />
            ) : activeSettingsKey === "delete" ? (
              <DeleteAccount session={session} />
            ) : activeSettingsKey === "billing" ? (
              <PaymentBilling session={session} />
            ) : activeSettingsKey === "wakeword" ? (
              <WakeWord session={session} />
            ) : (
              <></>
            )

          ) : activeTab === "discover" ? (
            location.pathname.startsWith("/discover/news") ? (
              <NewsContent sidebarOpen={discoverOpen} onAskQuestion={handleNewsQuestion} />
            ) : (
              <DiscoverView withNavOffset={false} category={discoverCategory} />
            )
          ) : (
            <>
              {/* Voice mode: show minimal listening UI */}
              {isVoiceMode ? (
                <section className="uv-hero">
                  <BlackHole isActivated={isBlackHoleActive} />
                  {(isRecording || isTranscribing) && (
                    <h4
                      className="orb-caption"
                      style={{ fontSize: 22, opacity: 0.75, marginTop: 16 }}
                    >
                      Listening…
                    </h4>
                  )}
                </section>
              ) : (
                !activeSessionId && (
                  <section className="uv-hero">
                    <BlackHole />
                  </section>
                )
              )}

              {activeSessionId && !isNewChat && !isVoiceMode && (
                <div className="uv-chat-scroll-outer">
                  <div className="uv-chat-area">
                    {newsContext && (!newsContext.sessionId || newsContext.sessionId === activeSessionId) && (
                      <div className="uv-news-context-card">
                        {newsContext.imageUrl && (
                          <img
                            src={newsContext.imageUrl}
                            alt={newsContext.title}
                            className="uv-news-context-image"
                          />
                        )}
                        <div className="uv-news-context-body">
                          <div className="uv-news-context-title">{newsContext.title}</div>
                          <button
                            className="uv-news-context-link"
                            onClick={() => {
                              setActiveTab("discover");
                              setSidebarOpen(true);
                              navigate(`/discover/news/${newsContext.slug}`, {
                                state: {
                                  article: {
                                    title: newsContext.title,
                                    imageUrl: newsContext.imageUrl,
                                    description: newsContext.description,
                                    publishedAt: newsContext.publishedAt,
                                    releasedMinutes: newsContext.releasedMinutes,
                                    all_sources: newsContext.all_sources,
                                    url: newsContext.url,
                                  },
                                },
                              });
                            }}
                          >
                            Click here to go back to the news
                          </button>
                        </div>
                      </div>
                    )}
                    <ChatMessages messages={messages} isLoading={isSending || isSmartRecPending} />
                  </div>
                </div>
              )}

              {!isVoiceMode && (
  <div className="uv-input-container">
    {!activeSessionId && (
      <div className="av-chatbar-caption">
        <h3 className="orb-caption">
          Hi {profile?.username ?? "User"}, say{" "}
          <span className="visual-askvox">
            {`"${(profile?.wake_word?.trim?.() || "Hey AskVox")}"`}
          </span>{" "}
          to begin or type below.
        </h3>
      </div>
    )}
    <ChatBar
      onSubmit={handleSubmit}
      disabled={isSending}
      onQuizClick={() => setIsQuizOpen(true)}
    />

   <Quiz
  open={isQuizOpen}
  onClose={() => setIsQuizOpen(false)}
  userId={session.user.id}
  sessionId={activeSessionId}
  messages={messages}
/>


  </div>
)}

            </>
          )}
        </main>
        {isFolderModalOpen && (
          <div className="fm-overlay" role="dialog" aria-modal="true" aria-label="Create folder">
            <div className="fm-modal">
              <button className="fm-close" type="button" aria-label="Close" onClick={() => setFolderModalOpen(false)}>
                ✕
              </button>
              <div className="fm-title">Create New Folder</div>
              <div className="fm-sub">Choose a name for your folder.</div>
              <div className="fm-inputWrap">
                <input
                  className="fm-input"
                  value={folderModalName}
                  onChange={(e) => setFolderModalName(e.target.value)}
                  maxLength={64}
                  placeholder="e.g., Math Homework"
                />
              </div>
              {folderModalErr && <div className="fm-error">{folderModalErr}</div>}
              <div className="fm-actions">
                <button className="fm-btn fm-btnSecondary" type="button" onClick={() => setFolderModalOpen(false)} disabled={folderModalBusy}>
                  Cancel
                </button>
                <button className="fm-btn fm-btnPrimary" type="button" onClick={confirmCreateFolder} disabled={folderModalBusy || !folderModalName.trim()}>
                  {folderModalBusy ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabaseClient";
import type { Session } from "@supabase/supabase-js";

// Components
import Background from "../components/background/background";
import ChatBar from "../components/chat/ChatBar";
import BlackHole from "../components/background/Blackhole";
import RegisteredTopBar from "../components/TopBars/RegisteredTopBar"; 
import ChatMessages from "../components/chat/ChatMessages"; 
import Sidebar from "../components/Sidebar/Chat_Sidebar"; 
import NavRail from "../components/Sidebar/NavRail"; 
import "./cssfiles/UnregisteredMain.css";

// Types
import type { ChatMessage, DatabaseMessage, UserProfile } from "../types/database"; 

// Constants
const LLAMA_ID = 212020; 

export default function Dashboard({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  // Sidebar & Navigation State
  const [sessions, setSessions] = useState<{id: string, title: string}[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('chats'); 
  const [isSidebarOpen, setSidebarOpen] = useState(true); 
  const [isNewChat, setIsNewChat] = useState(false);
  const [folders, setFolders] = useState<{
    id: string;
    name: string;
    items: { id: string; title: string }[];
  }[]>([]);
  const sessionIdsInFolders = useMemo(
    () => new Set(folders.flatMap(f => f.items.map(i => i.id))),
    [folders]
  );

  const standaloneSessions = useMemo(
    () => sessions.filter(s => !sessionIdsInFolders.has(s.id)),
    [sessions, sessionIdsInFolders]
  );





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
      
    // Fetch Sessions
    supabase.from('chat_sessions').select('*,display_name').eq('user_id', session.user.id).order('created_at', { ascending: false })
      .then(({ data }) => data && setSessions(data));
  }, [session.user.id]);

  useEffect(() => {
    if (!activeSessionId) return; 

    const fetchMessages = async () => {
       const { data } = await supabase.from("chat_messages").select("*").eq("session_id", activeSessionId).order("created_at", { ascending: true });
      if (data) {
        setMessages(data.map((msg: DatabaseMessage) => ({
          id: msg.id, 
          senderId: msg.role === "user" ? session.user.id : LLAMA_ID, 
          content: msg.content, 
          createdAt: msg.created_at,
          displayName: msg.display_name // Mapping the name from DB to UI
        })));
      }
    };
    fetchMessages();
  }, [activeSessionId, session.user.id]); 

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
  };

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'chats') {
      setSidebarOpen(true); 
    } else {
      setSidebarOpen(false); 
    }
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setIsNewChat(true);
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
      .select("id, title")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (allSessions) setSessions(allSessions);
  };


  


  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !session?.user?.id) return;

    // 1. Determine Session ID
    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      // ✅ Create ONE new chat session
      const { data: newSession, error } = await supabase
        .from('chat_sessions')
        .insert({
          user_id: session.user.id,
          title: trimmed.slice(0, 30) + '...',
        })
        .select()
        .single();

      if (error || !newSession) {
        console.error('Failed to create chat session', error);
        return;
      }

      currentSessionId = newSession.id;
      setActiveSessionId(currentSessionId);

      // ✅ Refresh sidebar sessions from DB
      const { data: allSessions } = await supabase
        .from('chat_sessions')
        .select('id, title')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

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

    await supabase.from("queries").insert({
      id: queryId,
      session_id: currentSessionId,
      user_id: session.user.id,
      input_mode: "text",
      raw_audio_path: null,
      transcribed_text: trimmed,
      detected_domain: "general",
    });

    
    // 4. Save USER message to Supabase
    supabase.from('chat_messages').insert({ 
      session_id: currentSessionId, 
      user_id: session.user.id, 
      role: 'user', 
      content: trimmed,
      display_name: userName // <--- CRITICAL: Sending the name here
    }).then();

    try {
      // 5. Call AI API
      const response = await fetch("http://localhost:8000/llamachats/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: [
            ...messages.map(m => ({
              role: m.senderId === session.user.id ? "user" : "assistant",
              content: m.content,
            })),
            { role: "user", content: trimmed },
          ],
          query_id: queryId,         
          session_id: currentSessionId,
          user_id: session.user.id,
        })
      });

      
      const data = await response.json();
      console.log("🤖 AI Response Data:", data); // Debug Log

      // Handle different API response formats
      const replyText = data.answer || data.response || data.reply || ""; 

      // Guard against empty responses (Prevents the "Dots" issue)
      if (!replyText) {
        console.warn("⚠️ Empty response from AI. Not saving.");
        setIsSending(false);
        return;
      }
      
      setIsSending(false);
      

      const streamId = `llama-${Date.now()}`;
      setMessages(prev => [...prev, { 
        id: streamId, 
        senderId: LLAMA_ID, 
        content: replyText, 
        createdAt: new Date().toISOString(),
        displayName: "AskVox"
      }]);

    } catch (err) { 
       console.error("❌ Error sending message:", err);
       setIsSending(false); 
    }
  };

  const showSidebar = isSidebarOpen && activeTab === 'chats';

  return (
    <div className="uv-root" style={{ display: 'flex', overflowX: 'hidden' }}>
      <Background />
      
      <NavRail activeTab={activeTab} onTabClick={handleTabClick} />

      <Sidebar
        sessions={standaloneSessions}
        folders={folders}
        activeId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onClose={() => setSidebarOpen(false)}
        isOpen={showSidebar}
        onMoveChatToFolder={handleMoveChatToFolder}
      />


      <div style={{ 
        flex: 1, 
        marginLeft: '80px', 
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}>
        
        <RegisteredTopBar session={session} />

        <main className="uv-main">
          {!activeSessionId && (
            <section className="uv-hero">
              <BlackHole />
              <h3 style={{color: '#888', marginTop: '20px'}}>
                Welcome back, {profile?.username ?? "User"}
              </h3>
            </section>
          )}

          {activeSessionId && (
            <div className="uv-chat-scroll-outer">
              <div className="uv-chat-area">
                <ChatMessages messages={messages} isLoading={isSending} />
              </div>
            </div>
          )}
          
           <div className="uv-input-container">
             <ChatBar onSubmit={handleSubmit} disabled={isSending} />
           </div>
        </main>
      </div>
    </div>
  );
};
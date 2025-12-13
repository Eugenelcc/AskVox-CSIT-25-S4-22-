import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import type { Session } from "@supabase/supabase-js";

// Components
import Background from "../components/background/background";
import ChatBar from "../components/chat/ChatBar";
import BlackHole from "../components/background/Blackhole";
import UnregisteredTopBar from "../components/TopBars/unregisteredtopbar"; 
import ChatMessages from "../components/chat/ChatMessages"; 
import Sidebar from "../components/TopBars/Chat_Sidebar"; 
import NavRail from "../components/TopBars/NavRail"; 
import "./cssfiles/UnregisteredMain.css";

// Types
import type { ChatMessage, DatabaseMessage, UserProfile } from "../types/database"; 

const LLAMA_ID = "212020"; 

export default function Dashboard({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  // Sidebar & Navigation State
  const [sessions, setSessions] = useState<{id: string, title: string}[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('chats'); 
  const [isSidebarOpen, setSidebarOpen] = useState(true); 

  // --- Data Fetching ---
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => data && setProfile(data));
      
    supabase.from('chat_sessions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false })
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
          content: msg.content, createdAt: msg.created_at,
          // Optional: If you updated your types, you can map display_name here too
          displayName: msg.display_name 
        })));
      }
    };
    fetchMessages();
  }, [activeSessionId, session.user.id]); 

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
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !session?.user?.id) return;

    let currentSessionId = activeSessionId;

    // 1. Create Session if needed
    if (!currentSessionId) {
      const { data: newSession } = await supabase.from('chat_sessions')
        .insert({ user_id: session.user.id, title: trimmed.slice(0, 30) + '...' })
        .select().single();
      
      if (newSession) {
        currentSessionId = newSession.id;
        setActiveSessionId(currentSessionId);
        setSessions(prev => [newSession, ...prev]);
      }
    }

    // Optimistic Update
    setMessages(prev => [...prev, { id: `temp-${Date.now()}`, senderId: session.user.id, content: trimmed, createdAt: new Date().toISOString() }]);
    setIsSending(true);
    
    // ✅ UPDATE 1: Save User Message with "display_name"
    const userName = profile?.username || "User"; 

    supabase.from('chat_messages').insert({ 
      session_id: currentSessionId, 
      user_id: session.user.id, 
      role: 'user', 
      content: trimmed,
      display_name: userName // Saves "Eugene123"
    }).then();

    try {
      const response = await fetch("http://localhost:8000/llamachats/cloud", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: trimmed }) });
      const data = await response.json();
      const replyText = data.answer || data.response || data.reply || ""; 
      
      setIsSending(false);
      
      // ✅ UPDATE 2: Save AI Message with "AskVox"
      await supabase.from('chat_messages').insert({ 
        session_id: currentSessionId, 
        user_id: session.user.id, 
        role: 'assistant', 
        content: replyText,
        display_name: "AskVox" // ✅ NEW: Save AI Name
      });

      const streamId = `llama-${Date.now()}`;
      setMessages(prev => [...prev, { id: streamId, senderId: LLAMA_ID, content: replyText, createdAt: new Date().toISOString() }]);
    } catch (err) { 
       console.error("Error sending message:", err);
       setIsSending(false); 
    }
  };

  const showSidebar = isSidebarOpen && activeTab === 'chats';

  return (
    <div className="uv-root" style={{ display: 'flex', overflowX: 'hidden' }}>
      <Background />
      
      <NavRail activeTab={activeTab} onTabClick={handleTabClick} />

      <Sidebar 
        sessions={sessions} 
        activeId={activeSessionId} 
        onSelectSession={handleSelectSession} 
        onNewChat={handleNewChat}
        onClose={() => setSidebarOpen(false)}
        isOpen={showSidebar}
      />

      <div style={{ 
        flex: 1, 
        marginLeft: '80px', 
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}>
        
        <UnregisteredTopBar session={session} />

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
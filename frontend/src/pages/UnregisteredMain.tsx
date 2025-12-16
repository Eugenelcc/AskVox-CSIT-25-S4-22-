import { useCallback, useEffect, useState } from "react";
// ✅ 1. Import Session Type
import type { Session } from "@supabase/supabase-js";

import Background from "../components/background/background";
import ChatBar from "../components/chat/ChatBar";
import BlackHole from "../components/background/Blackhole";
import UnregisteredTopBar from "../components/TopBars/unregisteredtopbar";
import ChatMessages from "../components/chat/UnregisteredChatMessages";
import { useWakeWordBackend } from "../hooks/useWakeWordBackend.ts";
import { supabase } from "../supabaseClient";

import type { ChatMessage } from "../types/database"; 
import "./cssfiles/UnregisteredMain.css";

const USER_ID = 874902 as const;
const LLAMA_ID = 212020 as const;

// ✅ 2. Update Component to accept 'session' prop
const UnregisteredMain = ({ session }: { session: Session | null }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
  const micEnabled = true;

  const postLog = (text: string, kind: string) => {
    try {
      fetch('http://localhost:8000/voice/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind }),
      }).catch(() => {});
    } catch {}
  };

  // Load existing guest session id if present
  useEffect(() => {
    const existing = sessionStorage.getItem('guest_session_id');
    if (existing) setGuestSessionId(existing);
  }, []);

  // Ensure a guest chat_session exists (DB-backed only)
  const ensureGuestSession = async (titleHint: string): Promise<string> => {
    if (guestSessionId) return guestSessionId;

    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({
        user_id: null,
        title: (titleHint || 'Guest Chat').slice(0, 30) + '...',
      })
      .select()
      .single();

    if (error || !data?.id) {
      console.error('chat_sessions insert failed:', error);
      throw new Error('Guest session not created');
    }

    sessionStorage.setItem('guest_session_id', data.id);
    setGuestSessionId(data.id);
    return data.id;
  };



  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // 1. Create user object
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      senderId: USER_ID,
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    // Ensure guest session id for linking rows
    let currentSessionId: string;
    try {
      currentSessionId = await ensureGuestSession(trimmed);
    } catch (e) {
      console.error(e);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        senderId: LLAMA_ID,
        content: "Sorry, we couldn't start a guest session.",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setIsSending(false);
      return;
    }

    /* 👉 INSERT THE GUARD HERE 👈 */
    if (!currentSessionId) {
      console.error("No valid session_id, aborting inserts");
      setIsSending(false);
      return;
}

    // Insert into queries (capture query_id to link response)
    const queryId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      await supabase.from('queries').insert({
        id: queryId,
        session_id: currentSessionId,
        user_id: null,
        input_mode: 'text',
        raw_audio_path: null,
        transcribed_text: trimmed,
        detected_domain: 'general'
      });
    } catch {}

    // Mirror RegisteredMain: persist user chat message
    try {
      await supabase.from('chat_messages').insert({
        session_id: currentSessionId,
        user_id: null,
        role: 'user',
        content: trimmed,
        display_name: 'Guest'
      });
    } 
    catch {}

    // 2. Prepare history payload
    const historyPayload = [...messages, userMsg]
      .filter((m) => m.content.trim())
      .map((m) => ({
        role: m.senderId === USER_ID ? "user" : "assistant",
        content: m.content,
      }));

    // 3. Call the backend
    try {
      const streamId = `llama-${Date.now()}`;
      const resp = await fetch("http://localhost:8000/llamachats/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          query_id: queryId,
          session_id: currentSessionId,
        }),
      });

      if (!resp.ok) {
        console.error("Chat API error", resp.status);
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          senderId: LLAMA_ID,
          content: "Sorry, something went wrong when connecting with AskVox.",
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      const data = await resp.json();
      const replyText: string = data.answer ?? data.reply ?? "";

      // 4. Reveal Response (Typewriter Effect)
      setIsSending(false);

      const assistantMsg: ChatMessage = {
        id: streamId,
        senderId: LLAMA_ID,
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // --- NEW LOGIC START ---
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const step = 4;

      for (let i = 0; i <= replyText.length; i += step) {
        const partial = replyText.slice(0, i);
        setMessages((prev) =>
          prev.map((m) => (m.id === streamId ? { ...m, content: partial } : m))
        );
        await sleep(15);
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === streamId ? { ...m, content: replyText } : m))
      );
      // --- NEW LOGIC END ---

      // Mirror RegisteredMain: persist assistant chat message (optional)
      try {
        await supabase.from('chat_messages').insert({
          session_id: currentSessionId,
          user_id: null,
          role: 'assistant',
          content: replyText || '(No response received.)',
          display_name: 'AskVox'
        });
      } catch {}

      if (!replyText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId ? { ...m, content: "(No response received.)" } : m
          )
        );
      }
    } catch (err) {
      console.error("Network/LLM error", err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        senderId: LLAMA_ID,
        content: "Sorry, I could not reach AskVox server.",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  };

  // Voice: start mic on user approval, listen continuously, wake → "Yes?", then forward command.
  const speak = useCallback((s: string) => {
    try {
      const u = new SpeechSynthesisUtterance(s);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  useWakeWordBackend({
    enabled: micEnabled,
    onWake: () => {
      speak("Yes?");
    },
    onCommand: (cmd: string) => {
      if (cmd && cmd.trim()) {
        // For wake-word testing, do NOT send to chat/Cloud Run
        postLog(`(wake-test) captured command: ${cmd}`, 'command');
      }
    },
  });

  const hasMessages = messages.length > 0;

  return (
    <div className="uv-root">
      <Background />
      
      {/* ✅ 3. Pass the session to the TopBar */}
      <UnregisteredTopBar session={session} />

      <main className="uv-main">
        {/* Mic badge intentionally hidden; mic still active when permitted */}
        {!hasMessages && (
          <section className="uv-hero">
            <BlackHole />
          </section>
        )}

        {hasMessages && (
          <div className="uv-chat-scroll-outer">
            <div className="uv-chat-area">
              <ChatMessages messages={messages} isLoading={isSending} />
            </div>
          </div>
        )}
      </main>

      <ChatBar onSubmit={handleSubmit} disabled={isSending} />
    </div>
  );
};

export default UnregisteredMain;
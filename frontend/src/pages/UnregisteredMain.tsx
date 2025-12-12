// src/pages/UnregisteredMain.tsx
import { type FC, useState } from "react";
import Background from "../components/background/background";
import ChatBar from "../components/chat/ChatBar";
import BlackHole from "../components/background/Blackhole";
import UnregisteredTopBar from "../components/TopBars/unregisteredtopbar";
import ChatMessages from "../components/chat/ChatMessages";
import type { ChatMessage } from "../components/chat/ChatMessages";
import "./cssfiles/UnregisteredMain.css";

const USER_ID = 874902 as const;
const LLAMA_ID = 212020 as const;

const UnregisteredMain: FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

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
       //const resp = await fetch("http://localhost:8000/sealionchats",{
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: historyPayload }),
      });

      if (!resp.ok) {
        console.error("Chat API error", resp.status);
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          senderId: LLAMA_ID,
          content: "Sorry, something went wrong when connecting with AskVox.",
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      const data = await resp.json();
      const replyText: string = data.answer ?? data.reply ?? "";

      // 4. Reveal Response (Typewriter Effect)
      setIsSending(false);

      // Add an empty assistant message first
      const assistantMsg: ChatMessage = {
        id: streamId,
        senderId: LLAMA_ID,
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // --- NEW LOGIC START ---
      // We reveal characters instead of splitting by words.
      // This preserves '\n' (newlines) which splitting by whitespace destroys.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      
      // 'step' controls speed. 2-4 chars at a time is smooth and fast.
      const step = 4; 
      
      for (let i = 0; i <= replyText.length; i += step) {
        // Slice the string from 0 to current index
        const partial = replyText.slice(0, i);
        
        setMessages((prev) => 
          prev.map((m) => (m.id === streamId ? { ...m, content: partial } : m))
        );
        
        // Fast sleep (10-20ms) for a robotic typing feel
        await sleep(15); 
      }
      
      // Ensure the full text is definitely shown at the very end
      setMessages((prev) => 
        prev.map((m) => (m.id === streamId ? { ...m, content: replyText } : m))
      );
      // --- NEW LOGIC END ---

      if (!replyText) {
        setMessages((prev) => 
          prev.map((m) => (m.id === streamId ? { ...m, content: "(No response received.)" } : m))
        );
      }
    } catch (err) {
      console.error("Network/LLM error", err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        senderId: LLAMA_ID,
        content: "Sorry, I could not reach AskVox server.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="uv-root">
      <Background />
      <UnregisteredTopBar />

      <main className="uv-main">
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
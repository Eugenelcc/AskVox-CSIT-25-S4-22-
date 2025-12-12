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

    // This is to create user object
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      senderId: USER_ID,
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    // this is to convert all messages to a {role, content} format
    const historyPayload = [...messages, userMsg]
      .filter((m) => m.content.trim())
      .map((m) => ({
        role: m.senderId === USER_ID ? "user" : "assistant",
        content: m.content,
      }));


      // call the backend
    try {
      // Use the existing non-streaming `/chats/` endpoint to get the final
      // cleaned reply in one request, then reveal it word-by-word. This avoids
      // the extra round-trip and complexity of a streaming endpoint.
      const streamId = `llama-${Date.now()}`;
      const resp = await fetch("http://localhost:8000/llamachats/local", {    //llama chat endpoint
      //const resp = await fetch("http://localhost:8000/sealionchats", {    //sealion chat endpoint
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

      // Reveal: stop showing loader, insert assistant bubble, then reveal words
      setIsSending(false);
      const assistantMsg: ChatMessage = {
        id: streamId,
        senderId: LLAMA_ID,
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const words = (replyText || "").split(/\s+/).filter(Boolean);
      const revealMs = 40;
      for (let i = 1; i <= words.length; i++) {
        const partial = words.slice(0, i).join(" ");
        setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, content: partial } : m)));
        // eslint-disable-next-line no-await-in-loop
        await sleep(revealMs);
      }
      if (!replyText) {
        setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, content: "(No response received.)" } : m)));
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

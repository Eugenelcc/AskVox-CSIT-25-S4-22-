import { type FC, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./ChatMessages.css";
import Loading from "./Loading";

// IMPORT the types instead of defining them
import type { ChatMessage } from "../../types/database";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

// Helper to keep formatting clean
function cleanMarkdown(md: string): string {
  let out = md.replace(/\r\n/g, "\n");
  out = out.replace(/\s+(\d+\.\s)/g, "\n$1");
  out = out.replace(/\s+([-*]\s)/g, "\n$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/\n\n([*+-] )/g, "\n$1");
  out = out.replace(/\n\n(\d+\.) /g, "\n$1 ");
  out = out.replace(/\n[ \t]+\n/g, "\n\n");
  return out.trim();
}

const ChatMessages: FC<ChatMessagesProps> = ({ messages, isLoading }) => {
  // Autoscroll to bottom logic
  useEffect(() => {
    const container = document.querySelector(".uv-chat-scroll-outer") as HTMLElement | null;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  return (
    <div className="av-chat-window">
      <div className="av-chat-scroll">
        {messages.map((m) => {
          // ✅ Fix Logic: Assistant is always 212020, everyone else is User
          const isAssistant = m.senderId === 212020;
          const isUser = !isAssistant;

          return (
            <div
              key={m.id}
              className={`av-chat-row ${
                isUser ? "av-chat-row-user" : "av-chat-row-assistant"
              }`}
            >
              <div
                className={`av-chat-bubble ${
                  isUser ? "av-chat-bubble-user" : "av-chat-bubble-assistant"
                }`}
              >
                {isAssistant ? (
                  <div className="av-md">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p({ children }) {
                          const text = String(children).trim();
                          if (!text) return null;
                          return <p>{children}</p>;
                        },
                      }}
                    >
                      {cleanMarkdown(m.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  m.content
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="av-chat-row av-chat-row-assistant">
            <div className="av-chat-loading">
              <Loading />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessages;
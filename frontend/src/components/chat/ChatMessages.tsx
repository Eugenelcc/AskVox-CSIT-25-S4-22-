import { type FC, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./ChatMessages.css";
import Loading from "./Loading";

export type ChatSenderId = 874902 | 212020;

export interface ChatMessage {
  id: string;
  senderId: ChatSenderId;
  content: string;
  createdAt?: string;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

function cleanMarkdown(md: string): string {
  // Normalize Windows line endings
  let out = md.replace(/\r\n/g, "\n");

  // 🔹 If the model writes "1. ... 2. ... 3. ..." in a single paragraph,
  // insert a newline before every numbered item.
  // e.g. "1. AAA 2. BBB 3. CCC" -> "1. AAA\n2. BBB\n3. CCC"
  out = out.replace(/\s+(\d+\.\s)/g, "\n$1");

  // (Optional) also split inline bullet lists like "- item1 - item2"
  out = out.replace(/\s+([-*]\s)/g, "\n$1");

  // Collapse 3+ blank lines into max 2
  out = out.replace(/\n{3,}/g, "\n\n");

  // Avoid blank line before list bullets
  out = out.replace(/\n\n([*+-] )/g, "\n$1");

  // Avoid blank line before numbered lists
  out = out.replace(/\n\n(\d+\.) /g, "\n$1 ");

  // Remove lines that are just spaces
  out = out.replace(/\n[ \t]+\n/g, "\n\n");

  return out.trim();
}

const ChatMessages: FC<ChatMessagesProps> = ({ messages, isLoading }) => {
  useEffect(() => {
    const container = document.querySelector(
      ".uv-chat-scroll-outer"
    ) as HTMLElement | null;
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
          const isUser = m.senderId === 874902;
          const isAssistant = m.senderId === 212020;

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

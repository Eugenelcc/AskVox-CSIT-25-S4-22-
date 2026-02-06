

import { type FC, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./ChatMessages.css";
import Loading from "./Loading";
import type { ChatMessage } from "../../types/database";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

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

function normalizeMarkdownImageSrc(src: string | undefined): string | null {
  if (!src) return null;
  const trimmed = String(src).trim();
  if (!trimmed) return null;
  // Ignore non-URLs like "Arsenal" or "logo.png" produced by the model.
  const isHttp = /^https?:\/\//i.test(trimmed);
  const isData = /^data:image\//i.test(trimmed);
  if (!isHttp && !isData) return null;

  // Avoid mixed-content blocks when app is served over https.
  if (isHttp && trimmed.startsWith("http://") && window.location.protocol === "https:") {
    return trimmed.replace(/^http:\/\//i, "https://");
  }
  return trimmed;
}

const ChatMessages: FC<ChatMessagesProps> = ({ messages, isLoading }) => {
  const [openSourcesForMsg, setOpenSourcesForMsg] = useState<string | number | null>(null);
  const markdownComponents = useMemo(
    () => ({
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        const normalized = normalizeMarkdownImageSrc(src);
        if (!normalized) return alt ? <span>{alt}</span> : null;

        return (
          <img
            src={normalized}
            alt={alt ?? ""}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              // Hide broken images to avoid the browser "broken file" icon.
              const target = e.currentTarget as HTMLImageElement;
              target.style.display = "none";
            }}
          />
        );
      },
    }),
    []
  );

  useEffect(() => {
    const container = document.querySelector(".uv-chat-scroll-outer") as HTMLElement | null;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="av-chat-window">
      <div className="av-chat-scroll">
        {messages.map((m) => {
          const isAssistant = m.senderId === 212020;
          const isUser = !isAssistant;
          const sources = m.meta?.sources ?? [];
          const images = m.meta?.images ?? [];
          const youtube = m.meta?.youtube ?? [];

          return (
            <div
              key={m.id}
              className={`av-chat-row ${isUser ? "av-chat-row-user" : "av-chat-row-assistant"}`}
            >
              <div className={`av-chat-bubble ${isUser ? "av-chat-bubble-user" : "av-chat-bubble-assistant"}`}>
                {isAssistant ? (
                  <>
                    <div className="av-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {cleanMarkdown(m.content)}
                      </ReactMarkdown>
                    </div>

                    {/* ✅ Images (below text like ChatGPT) */}
                    {images.length > 0 && (
                      <div className="av-media-row">
                        {images.map((img, idx) => (
                          <a
                            key={idx}
                            className="av-image-card"
                            href={img.url}
                            target="_blank"
                            rel="noreferrer"
                            title={img.alt ?? "Image"}
                          >
                            <img src={img.url} alt={img.alt ?? "Image"} />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* ✅ YouTube embeds (below images like ChatGPT) */}
                    {youtube.length > 0 && (
                      <div className="av-video-col">
                        {youtube.map((v) => (
                          <div key={v.video_id} className="av-youtube-card">
                            <div className="av-youtube-title">{v.title}</div>
                            <iframe
                              className="av-youtube-frame"
                              src={`https://www.youtube.com/embed/${v.video_id}`}
                              title={v.title}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ✅ Knowledge sources panel (your design) */}
                    {sources.length > 0 && (
                      <div className="av-sources-bar">
                        <button
                          className="av-sources-pill"
                          type="button"
                          onClick={() => setOpenSourcesForMsg(openSourcesForMsg === m.id ? null : m.id)}
                        >
                          {sources.length} sources
                        </button>
                      </div>
                    )}

                    {/* ✅ Sources modal (right-side panel style) */}
                    {openSourcesForMsg === m.id && sources.length > 0 && (
                      <div className="av-sources-modal" role="dialog" aria-modal="true">
                        <button
                          className="av-sources-close"
                          type="button"
                          aria-label="Close"
                          onClick={() => setOpenSourcesForMsg(null)}
                        >
                          ✕
                        </button>
                        <div className="av-sources-title">Sources</div>
                        <div className="av-sources-list">
                          {sources.map((s, idx) => (
                            <a
                              key={idx}
                              className="av-source-item"
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <div className="av-source-name">{s.title}</div>
                              <div className="av-source-url">{s.url}</div>
                              {s.snippet && <div className="av-source-snippet">{s.snippet}</div>}
                              <div className="av-source-divider" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
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

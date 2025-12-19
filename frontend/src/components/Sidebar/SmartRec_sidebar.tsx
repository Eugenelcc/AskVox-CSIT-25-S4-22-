import { useEffect, useRef, useState } from "react";
import "./cssfiles/SmartRec.css";
import { RotateCw } from "lucide-react";

type TopicItem = { id: string; topic: string };
type DomainCard = { domain: string; topics: TopicItem[] };

const API_BASE = "http://localhost:8000";

export default function SmartRecPanel({
  userId,
  onOpenSession,
}: {
  userId: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const [domains, setDomains] = useState<DomainCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const callJson = async (url: string, init: RequestInit) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await fetch(url, { ...init, signal: controller.signal });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`);
    return data;
  };

  const generateProfile = async () => {
    if (!userId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await callJson(`${API_BASE}/smartrec/generate_profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, limit: 80 }),
      });
      setDomains(data.domains ?? []);
    } catch (e: any) {
      // IMPORTANT: ignore abort errors (they are expected)
      if (e?.name === "AbortError" || String(e?.message || "").toLowerCase().includes("aborted")) {
        return;
      }
      setErrorMsg(e?.message || "Failed to generate recommendations.");
    } finally {
      setLoading(false);
    }
  };

  const handleTopicClick = async (recId: string) => {
    if (!userId || loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await callJson(`${API_BASE}/smartrec/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, recommendation_id: recId }),
      });

      if (data.domains) setDomains(data.domains);
      if (data.session_id) onOpenSession(data.session_id);
    } catch (e: any) {
      if (e?.name === "AbortError" || String(e?.message || "").toLowerCase().includes("aborted")) {
        return;
      }
      setErrorMsg(e?.message || "Failed to open topic.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    generateProfile();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <aside className="sr-panel">
      <div className="sr-top">
        <div className="sr-title">Suggested Topics</div>

        <button className="sr-refresh" type="button" onClick={generateProfile} disabled={loading}>
          {loading ? "…" : <RotateCw size={22} />}
        </button>
      </div>

      <div className="av-divider" />

      <div className="sr-domainList">
        {!!errorMsg && (
          <div className="sr-empty">
            {errorMsg}
            <div style={{ marginTop: 8, opacity: 0.8 }}>
              Try refreshing, or ask a new question first ✨
            </div>
          </div>
        )}

        {domains.map((d) => (
          <section key={d.domain} className="sr-domainCard">
            {/* domain glow */}
            <div className="sr-glow" data-domain={d.domain} />

            <div className="sr-domainHeader">
              <div className="sr-domainName">{d.domain}</div>
              <div className="sr-domainSub">Pick a topic</div>
            </div>

            <div className="sr-topicGrid">
              {d.topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="sr-topicBtn"
                  onClick={() => handleTopicClick(t.id)}
                  disabled={loading}
                  title={t.topic}
                >
                  {t.topic}
                </button>
              ))}
            </div>
          </section>
        ))}


        {!domains.length && !loading && !errorMsg && (
          <div className="sr-empty">No recommendations yet — ask a few questions first ✨</div>
        )}
      </div>
    </aside>
  );
}

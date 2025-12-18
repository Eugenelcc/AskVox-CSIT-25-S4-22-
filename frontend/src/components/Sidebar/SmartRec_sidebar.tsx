import { useEffect, useState } from "react";
import "./cssfiles/SmartRec.css";
import {RotateCw} from "lucide-react";

type Rec = {
  id: string;
  domain: string;
  topic: string;
  clicked_at: string | null;
};

export default function SmartRecPanel({
  userId,
  onOpenSession,
}: {
  userId: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(false);

  const list = async () => {
    const res = await fetch(`http://localhost:8000/smartrec/list?user_id=${userId}&limit=10`);
    const data = await res.json();
    setItems(data.recommendations ?? []);
  };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/smartrec/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, limit: 30 }),
      });
      const data = await res.json();
      setItems(data.recommendations ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    list();
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleClick = async (recId: string) => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/smartrec/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, recommendation_id: recId }),
      });
      const data = await res.json();
      if (data.session_id) onOpenSession(data.session_id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="sr-panel">
      <div className="sr-top">
        <div className="sr-title">Suggested Topics</div>
        <button className="sr-refresh" type="button" onClick={generate} disabled={loading}>
          {loading ? "…" : < RotateCw size={22} />}
        </button>
      </div>
      <div className="av-divider" />

      <div className="sr-list">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className="sr-card"
            onClick={() => handleClick(it.id)}
            disabled={loading}
          >
            <div className="sr-glow" data-domain={it.domain} />


            <div className="sr-copy">
              <div className="sr-line">
                Because you asked about <span className="sr-domain">{it.domain}</span>, AskVox thinks you will like:
              </div>

              <div className="sr-pill">
                <span className="sr-pillText">{it.topic}</span>
              </div>
            </div>
          </button>
        ))}

        {!items.length && !loading && (
          <div className="sr-empty">No recommendations yet — ask a few questions first ✨</div>
        )}
      </div>
    </aside>
  );
}

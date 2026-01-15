import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import AskVoxStarBackground from "../../components/background/background";

// Minimal admin panel to review educational verification requests
// Renders a simple table with Approve/Reject actions.

type Request = {
  id: string;
  user_id: string;
  institute_name: string;
  email_domain: string;
  contact_person: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

export default function AdminEducation() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Request[]>([]);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [me, setMe] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));

    const load = async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await supabase
          .from("education_verification_requests")
          .select("id,user_id,institute_name,email_domain,contact_person,notes,status,created_at,reviewed_by,reviewed_at")
          .eq("status", filter)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!mounted) return;
        setRows((data as any as Request[]) || []);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load requests");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    const t = setInterval(load, 15000); // auto-refresh every 15s
    return () => { mounted = false; clearInterval(t); };
  }, [filter]);

  const runAction = async (id: string, action: "approve" | "reject") => {
    try {
      if (action === "approve") {
        const { error } = await supabase
          .from("education_verification_requests")
          .update({ status: "approved", reviewed_by: me, reviewed_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
        setRows((r) => r.filter((x) => x.id !== id));
        setToast("Approved • User can subscribe to Educational plan directly");
      } else {
        const { error } = await supabase
          .from("education_verification_requests")
          .update({ status: "rejected", reviewed_by: me, reviewed_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
        setRows((r) => r.filter((x) => x.id !== id));
        setToast("Rejected • Request moved out of pending");
      }
    } catch (e: any) {
      setToast(e?.message || "Action failed");
    } finally {
      setTimeout(() => setToast(null), 2500);
    }
  };

  const reject = (id: string) => void runAction(id, "reject");
  const approve = (id: string) => void runAction(id, "approve");

  const counts = useMemo(() => {
    return { total: rows.length };
  }, [rows]);

  return (
    <>
      <AskVoxStarBackground />
      <div style={{ padding: 24, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ margin: 0, fontWeight: 500 }}>Admin • Education Requests</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => navigate("/logout-success")}
              style={{
                background: "#1c1c1c",
                border: "1px solid #ff951c",
                color: "#f0f0f0",
                padding: "8px 16px",
                borderRadius: 16,
                boxShadow: "1px 1px 12.8px #ff951c",
                cursor: "pointer",
              }}
            >
              Logout
            </button>
            <button
              onClick={() => navigate("/platformadmin/dashboard")}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,.25)", color: "#fff", padding: "8px 12px", borderRadius: 999, cursor: "pointer" }}
            >
              ← Back
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          {(["pending", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid #a25600",
                background: filter === f ? "#ff951c" : "transparent",
                color: filter === f ? "#000" : "#fff",
                cursor: "pointer",
              }}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 14, opacity: 0.8, fontSize: 13 }}>
          Showing {counts.total} {filter} request{counts.total === 1 ? "" : "s"}
        </div>

        {err && <div style={{ marginTop: 12, color: "#ff8080" }}>{err}</div>}

        <div style={{ marginTop: 12, border: "1px solid rgba(255,149,28,.35)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "180px 220px 200px 160px 1fr 150px", gap: 0, padding: "10px 12px", background: "#0c0c0c", borderBottom: "1px solid rgba(255,255,255,.06)", fontWeight: 600 }}>
            <div>Date</div>
            <div>Institute</div>
            <div>Domain</div>
            <div>Contact</div>
            <div>Notes</div>
            <div>Actions</div>
          </div>

          {loading ? (
            <div style={{ padding: 18, textAlign: "center", opacity: 0.8 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", opacity: 0.8 }}>No {filter} requests.</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "180px 220px 200px 160px 1fr 150px", gap: 0, padding: "12px", background: "#111", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                <div>{r.created_at ? new Date(r.created_at).toLocaleString() : "--"}</div>
                <div>{r.institute_name}</div>
                <div>{r.email_domain}</div>
                <div>{r.contact_person}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{r.notes || ""}</div>
                <div>
                  {filter === "pending" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => approve(r.id)} style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #2e7d32", background: "#2e7d32", color: "#fff", cursor: "pointer" }}>Approve</button>
                      <button onClick={() => reject(r.id)} style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #c62828", background: "#c62828", color: "#fff", cursor: "pointer" }}>Reject</button>
                    </div>
                  ) : (
                    <span style={{ opacity: 0.8 }}>{r.status}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {toast && (
          <div role="status" aria-live="polite"
               style={{ position: "fixed", right: 18, bottom: 18, background: "#2a2a2a", border: "1px solid rgba(255,149,28,.35)", color: "#ff951c", padding: "10px 14px", borderRadius: 12, boxShadow: "0 6px 18px rgba(0,0,0,.45)", zIndex: 1000 }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}

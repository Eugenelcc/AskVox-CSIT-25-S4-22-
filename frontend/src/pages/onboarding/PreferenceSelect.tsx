import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import Background from "../../components/background/background";

type Preference = "secondary" | "tertiary" | "university" | "leisure";

interface Props {
  session: Session;
}

export default function PreferenceSelect({ session }: Props) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPref, setCurrentPref] = useState<Preference>("leisure");
  const userId = session.user.id;

  // Load existing preference if set
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("learning_preference")
          .eq("id", userId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.warn("Failed to load preference:", error.message);
          return;
        }
        const pref = (data?.learning_preference ?? "").toString().toLowerCase();
        if (pref === "secondary" || pref === "tertiary" || pref === "university" || pref === "leisure") {
          setCurrentPref(pref as Preference);
        }
      } catch (e) {
        console.warn("Preference load exception:", (e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const options: Array<{ key: Preference; title: string; desc: string }> = useMemo(() => [
    { key: "secondary", title: "Secondary", desc: "School-level learning: fundamentals, exam prep, and practice." },
    { key: "tertiary", title: "Tertiary", desc: "Diploma/certificate learning: applied skills and assessments." },
    { key: "university", title: "University", desc: "Degree-level learning: theory, research, and advanced topics." },
    { key: "leisure", title: "Leisure Learning", desc: "Casual exploration and self-paced learning (default)." },
  ], []);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ learning_preference: currentPref })
        .eq("id", userId);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      // Go to main app after onboarding
      navigate("/newchat", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <>
      <Background />
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 860, padding: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Choose Your Learning Preference</h1>
          <p style={{ marginTop: 8, color: "#cfcfcf" }}>Select the option that best matches how you'll use AskVox. You can change this later in Settings.</p>
          <p style={{ marginTop: 6, color: "#ff8080" }}>Disclaimer: Your AskVox answers, explanations, and recommendations will be tailored to the selected preference to better suit your learning goals.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
          {options.map((opt) => {
            const selected = currentPref === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setCurrentPref(opt.key)}
                style={{
                  textAlign: "left",
                  borderRadius: 12,
                  padding: 16,
                  background: selected ? "#1a1a1a" : "#111111",
                  border: selected ? "1px solid #ff951c" : "1px solid rgba(255,149,28,.35)",
                  boxShadow: selected ? "0 0 0 4px rgba(255,149,28,0.18)" : "none",
                  transition: "background 0.2s ease, box-shadow 0.2s ease",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{opt.title}</div>
                    <div style={{ marginTop: 6, fontSize: 14, color: "#d0d0d0" }}>{opt.desc}</div>
                  </div>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      border: selected ? "6px solid #ff951c" : "2px solid rgba(255,149,28,.5)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ marginTop: 12, color: "#ff8b8b" }}>Error: {error}</div>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              background: saving ? "#a25600" : "#ff951c",
              color: "#fff",
              border: "none",
              cursor: saving ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
          <button
            type="button"
            onClick={() => { navigate("/newchat"); }}
            disabled={saving}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              background: "#1a1a1a",
              color: "#f0f0f0",
              border: "1px solid #754B1C",
              cursor: saving ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

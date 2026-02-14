import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import styles from "./billing.module.css";
import { Check } from "lucide-react";
import voicePng from "./voice.png";

export default function WakeWord({ session }: { session: Session }) {
  const userId = session.user.id;
  const [value, setValue] = useState("");
  const [initial, setInitial] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("wake_word")
          .eq("id", userId)
          .maybeSingle();
        const ww = (data?.wake_word ?? "") as string;
        if (mounted) {
          setInitial(ww || "Bazinga!");
          setValue(ww || "Bazinga!");
        }
      } catch {
        if (mounted) {
          setInitial("Bazinga!");
          setValue("Bazinga!");
        }
      }
    })();
    return () => { mounted = false; };
  }, [userId]);

  const save = async () => {
    const trimmed = (value || "").trim();
    if (!trimmed) { setErr("Wake word cannot be empty"); return; }
    setBusy(true); setErr(null); setSaved(false);
    try {
      const sess = (await supabase.auth.getSession()).data.session;
      const token = sess?.access_token as string | undefined;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(`${import.meta.env.VITE_API_URL}/wake/wake_word`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ wake_word: trimmed }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(detail || "Failed to save wake word");
      }
      setInitial(trimmed);
      setSaved(true);
      setShowDone(true);
      try {
        window.dispatchEvent(new Event("askvox:profile-updated"));
      } catch {
        /* ignore */
      }
      // Auto-close modal after 3 seconds
      window.setTimeout(() => {
        // Return to the edit view after showing success for 3s
        setSaved(false);
        setShowDone(false);
        // Keep modal open; user can continue editing or close via X
      }, 3000);
    } catch (e: any) {
      setErr(e?.message || "Failed to save wake word");
    } finally {
      setBusy(false);
    }
  };

  // Always render the modal; no close button/state.

  return (
    <div className={styles.wrap} aria-label="Customize Wake Word">
      <div className={styles.modalNarrow} style={{ marginTop: 300 }}>

        <div className={styles.modalHeaderRow}>
          <div className={styles.headerIcon}>
            <img src={voicePng} alt="Voice" style={{ width: 28, height: 28 }} />
          </div>
          <div className={styles.modalTitle}>Customize Wake Word</div>
        </div>

        {showDone ? (
          <div className={styles.modalSection} style={{ textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 12, marginBottom: 24 }}>
              <div
                style={{
                  position: "relative",
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  border: "10px solid #ED8B1B",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    width: 120,
                    height: 120,
                    borderRadius: "50%",
                    border: "10px solid #ED8B1B",
                    opacity: 0.4,
                    transform: "scale(0.82)",
                  }}
                />
                <Check color="#ED8B1B" size={56} strokeWidth={3} />
              </div>
            </div>
            <p style={{ fontSize: 18, lineHeight: 1.6 }}>
              Done! Your new wake word is live. Say it now and see
              <br />
              AskVox respond!
            </p>
          </div>
        ) : (
          <>
            <div className={styles.modalSection}>
              <div className={styles.sectionLabel}>Set your custom wake word</div>
              <p style={{ opacity: 0.9, lineHeight: 1.6 }}>
                Type the phrase you want AskVox to listen for to activate the conversational AI,
                then click Submit to save it.
              </p>
            </div>

            <div className={styles.modalSection}>
              <input
                className={styles.input}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={initial || "Bazinga!"}
                maxLength={64}
              />
              {err && <div className={styles.error}>{err}</div>}
              <div className={styles.modalActions}>
                <button className={styles.btnPrimary} onClick={save} disabled={busy}>
                  {busy ? "Saving…" : "Submit"}
                </button>
              </div>
              {saved && (
                <div className={styles.successInline} style={{ marginTop: 10 }}>
                  <span className={styles.successDot} />
                  <span className={styles.successText}>Wake word updated</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

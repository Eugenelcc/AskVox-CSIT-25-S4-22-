import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import { Trash2, Eye, EyeOff, X } from "lucide-react";
import "./cssfiles/DeleteAccount.css";

export default function DeleteAccount({ session }: { session: Session }) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [done, setDone] = useState(false);

  const openConfirm = () => {
    if (!ack) return;
    setErr(null);
    setConfirmOpen(true);
  };

  const verifyPasswordThenDelete = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const email = session.user.email || "";
      if (!email) throw new Error("No email on session.");
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr) throw new Error("Incorrect password. Please try again.");

      // TODO: Replace with your backend irreversible deletion
      // await fetch("http://localhost:8000/me/delete", { method: "POST", credentials: "include" })
      await new Promise((r) => setTimeout(r, 600));

      // Show success panel, then sign out and redirect to Unregistered
      setDone(true);
      setConfirmOpen(false);
      setPassword("");
      setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = "/"; // Unregistered page
      }, 1800);
    } catch (e: any) {
      setErr(e?.message || "Verification failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="da-wrap">
      <div className="da-card">
        <div className="da-head">
          <Trash2 size={28} className="da-icon" />
          <div className="da-title">Delete Account</div>
        </div>

        <div className="da-panel">
          {done ? (
            <div className="da-successBox">
              <div className="da-successTick" />
              <div className="da-successTitle">Account Deleted Successfully</div>
              <div className="da-successSub">Your AskVox account has been removed.</div>
              <div className="da-successSub">We’re sad to see you go, and we hope to have you back someday</div>
            </div>
          ) : (
            <>
              <div className="da-panelTitle">Account Deletion, Important Notice:</div>
              <ul className="da-bullets">
                <li>By proceeding with account deletion, you acknowledge that this action is irreversible.</li>
                <li>All personal data associated with your account, including chats, saved preferences, and profile information will be permanently deleted.</li>
                <li>You will immediately lose access to your AskVox account and any services tied to it.</li>
                <li>We may retain non-identifiable, aggregated or legally required data for security, fraud prevention, and compliance purposes.</li>
                <li>Any active subscriptions will be automatically cancelled and no further charges will apply.</li>
              </ul>

              <label className="da-ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand that my data and account cannot be recovered once deleted.</span>
              </label>

              {err && <div className="da-error">{err}</div>}

              <button className="da-dangerBtn" type="button" disabled={!ack || busy} onClick={openConfirm}>
                Proceed to Delete Account
              </button>
            </>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div className="da-confirmOverlay" role="dialog" aria-modal="true" aria-label="Verify account ownership">
          <div className="da-confirmModal">
            <button className="da-modalClose" type="button" onClick={() => setConfirmOpen(false)} aria-label="Close">
              <X size={20} />
            </button>
            <div className="da-confirmTitle">Before we delete your account, we need to verify it’s really you.</div>
            <div className="da-confirmSub">Please enter your AskVox password to proceed.</div>

            <div className="da-inputWrap">
              <input
                className="da-input"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
              <button className="da-eyeBtn" type="button" onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {err && <div className="da-error" style={{ marginTop: 8 }}>{err}</div>}

            <button className="da-confirmBtn" type="button" disabled={busy || !password.trim()} onClick={verifyPasswordThenDelete}>
              {busy ? "Processing..." : "Yes, Delete My Account Permanently"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import { Trash2, X, MailCheck, CheckCircle2 } from "lucide-react";
import "./cssfiles/DeleteAccount.css";

export default function DeleteAccount({ session }: { session: Session }) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);

  const openConfirm = async () => {
    if (!ack) return;
    setErr(null);
    setConfirmOpen(true);
    // Send OTP to user's email
    try {
      const email = session.user.email || "";
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setErr(e?.message || "Failed to send OTP. Please try again.");
    }
  };

  const verifyOtpAndDelete = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const email = session.user.email || "";
      if (!email) throw new Error("No email on session.");
      // 1) Verify OTP
      const { error: otpErr } = await supabase.auth.verifyOtp({ email, token: otp, type: "email" });
      if (otpErr) throw new Error("Invalid or expired OTP");

      // 2) Call backend to delete via Service Role
      const { data: sess } = await supabase.auth.getSession();
      const access = sess.session?.access_token;
      if (!access) throw new Error("Missing session token");
      const res = await fetch("http://localhost:8000/auth/delete-account-supabase", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!res.ok) throw new Error("Delete failed");

      // Show success panel; redirect only when user clicks the close button
      setDone(true);
      setConfirmOpen(false);
      setOtp("");
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
              <div className="da-successInner">
                <button
                  className="da-modalClose"
                  type="button"
                  aria-label="Close"
                  onClick={async () => { await supabase.auth.signOut(); window.location.href = "/"; }}
                >
                  <X size={20} />
                </button>
                <div className="da-successIconWrap">
                  <CheckCircle2 className="da-successIcon" size={72} />
                </div>
                <div className="da-successTitle">Account Deleted Successfully</div>
                <div className="da-successSub">Your AskVox account has been removed.</div>
                <div className="da-successSub">We’re sad to see you go, and we hope to have you back someday</div>
              </div>
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
            <div className="da-confirmSub">
              {sent ? (
                <>
                  <MailCheck size={18} style={{ marginRight: 6 }} />
                  We’ve sent a 6-digit OTP to your email. Enter it below.
                </>
              ) : (
                "Sending code..."
              )}
            </div>

            <div className="da-inputWrap">
              <input
                className="da-input"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter 6-digit OTP"
              />
            </div>

            {err && <div className="da-error" style={{ marginTop: 8 }}>{err}</div>}

            <button className="da-confirmBtn" type="button" disabled={busy || otp.trim().length !== 6} onClick={verifyOtpAndDelete}>
              {busy ? "Processing..." : "Yes, Delete My Account Permanently"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

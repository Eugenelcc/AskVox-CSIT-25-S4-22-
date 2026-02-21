import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import AskVoxStarBackground from "../../components/background/background";
import AdminNavRail from "../../components/Sidebar/AdminNavRail";
import EducationalNavRail from "../../components/Sidebar/EducationalNavRail";
import { supabase } from "../../supabaseClient";
import "./cssfiles/AccountDetails.css";
import "./cssfiles/AccountEdit.css";
import {
  getCooldownMsFromRateLimitErrorMessage,
  isRateLimitErrorMessage,
} from "../../utils/rateLimit";
import { isGoogleOauthOnlyAccount } from "../../utils/authProviders";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatSeconds(s: number): string {
  const n = Math.max(0, Math.ceil(s));
  const mm = Math.floor(n / 60);
  const ss = n % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

interface Props {
  session: Session;
  isAdmin: boolean;
  sidebarVariant?: "educational";
}

export function AccountPasswordCard({ session }: { session: Session }) {
  const navigate = useNavigate();
  const email = useMemo(() => session.user.email ?? "", [session.user.email]);
  const isGoogleOnly = useMemo(() => isGoogleOauthOnlyAccount(session.user), [session.user]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const cooldownKey = useMemo(() => `askvox:passwordResetCooldown:${session.user.id}`, [session.user.id]);
  const [cooldownUntil, setCooldownUntil] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(cooldownKey);
      const parsed = raw ? Number(raw) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  });
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, cooldownUntil - now);
  const inCooldown = remainingMs > 0;

  const applyCooldown = (cooldownMs: number) => {
    const ms = Math.max(0, cooldownMs);
    const until = Date.now() + ms;
    setCooldownUntil(until);
    try {
      window.localStorage.setItem(cooldownKey, String(until));
    } catch {
      // ignore
    }
  };

  const sendReset = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (isGoogleOnly) {
      setErrorMsg(
        "This account is connected to Google sign-in. Password changes are managed through Google."
      );
      return;
    }

    if (inCooldown) {
      setErrorMsg(`Please wait ${formatSeconds(remainingMs / 1000)} before trying again.`);
      return;
    }

    if (!email) {
      setErrorMsg("Your account has no email address set.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        if (isRateLimitErrorMessage(error.message)) {
          const cooldownMs = getCooldownMsFromRateLimitErrorMessage(error.message, {
            fallbackMs: 2 * 60_000,
          });
          applyCooldown(cooldownMs);
          setErrorMsg(
            `Email rate limit exceeded. Please wait ${formatSeconds(cooldownMs / 1000)} before trying again.`
          );
        } else {
          setErrorMsg(error.message);
        }
        return;
      }

      const until = Date.now() + 60_000;
      setCooldownUntil(until);
      try {
        window.localStorage.setItem(cooldownKey, String(until));
      } catch {
        // ignore
      }

      setSuccessMsg(
        "Password reset link sent. Please check your inbox and follow the link to set a new password."
      );
    } catch (err) {
      const msg = getErrorMessage(err);
      if (isRateLimitErrorMessage(msg)) {
        const cooldownMs = getCooldownMsFromRateLimitErrorMessage(msg, {
          fallbackMs: 2 * 60_000,
        });
        applyCooldown(cooldownMs);
        setErrorMsg(
          `Email rate limit exceeded. Please wait ${formatSeconds(cooldownMs / 1000)} before trying again.`
        );
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="acc-wrap">
      <div className="acc-card">
        <div className="acc-head">
          <div className="acc-title">Change Password</div>
        </div>

        <div className="acc-inner">
          <div className="acc-editForm">
            <div className="acc-editRow">
              <div className="acc-editLabel">Account email</div>
              <div className="acc-editValue">{email || "-"}</div>
            </div>

            <div className="acc-editHelp">
              For security, we’ll email you a confirmation link to change your
              password.
            </div>

            {errorMsg && <div className="acc-editAlert acc-editAlert--error">{errorMsg}</div>}
            {successMsg && (
              <div className="acc-editAlert acc-editAlert--success">{successMsg}</div>
            )}

            <div className="acc-editActions">
              <button
                type="button"
                className="acc-editBtnSecondary"
                onClick={() => navigate("/settings/account")}
                disabled={loading}
              >
                Back
              </button>
              <button
                type="button"
                className="acc-editBtnPrimary"
                onClick={sendReset}
                disabled={loading || inCooldown || isGoogleOnly}
              >
                {loading
                  ? "Sending…"
                  : inCooldown
                  ? `Wait ${formatSeconds(remainingMs / 1000)}`
                  : isGoogleOnly
                  ? "Google Account"
                  : "Send Reset Link"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountPasswordPage({ session, isAdmin, sidebarVariant }: Props) {
  const navigate = useNavigate();

  if (isAdmin) {
    return (
      <>
        <AskVoxStarBackground />
        <div className="admin-wrap admin-layout">
          <aside className="admin-sidebar">
            <AdminNavRail onNavigate={(path) => navigate(path)} />
          </aside>
          <main>
            <AccountPasswordCard session={session} />
          </main>
        </div>
      </>
    );
  }

  if (sidebarVariant === "educational") {
    return (
      <>
        <AskVoxStarBackground />
        <div className="admin-wrap admin-layout">
          <aside className="admin-sidebar">
            <EducationalNavRail activeTab="settings" onNavigate={(path) => navigate(path)} />
          </aside>
          <main>
            <AccountPasswordCard session={session} />
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <AskVoxStarBackground />
      <AccountPasswordCard session={session} />
    </>
  );
}

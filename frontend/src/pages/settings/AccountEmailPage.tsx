import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
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

export function AccountEmailCard({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isGoogleOnly = useMemo(() => isGoogleOauthOnlyAccount(session.user), [session.user]);

  const currentEmail = useMemo(() => session.user.email ?? "", [session.user.email]);

  const [newEmail, setNewEmail] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // One-time notice after clicking the verification link.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const notice = (params.get("notice") || "").toLowerCase();
    if (notice !== "email_changed") return;

    setErrorMsg(null);
    setSuccessMsg("Email change confirmed. Your account email has been updated.");

    params.delete("notice");
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const cooldownKey = useMemo(() => `askvox:emailChangeCooldown:${session.user.id}`, [session.user.id]);
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (isGoogleOnly) {
      setErrorMsg(
        "This account is connected to Google sign-in. Email changes are not available here."
      );
      return;
    }

    if (inCooldown) {
      setErrorMsg(`Please wait ${formatSeconds(remainingMs / 1000)} before trying again.`);
      return;
    }

    const email = newEmail.trim();
    if (!email) {
      setErrorMsg("Please enter a new email address.");
      return;
    }
    if (!currentEmail) {
      setErrorMsg("Your account has no email address set.");
      return;
    }
    if (email.toLowerCase() === currentEmail.toLowerCase()) {
      setErrorMsg("That is already your current email address.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser(
        { email },
        {
          emailRedirectTo: `${window.location.origin}/auth/link-callback?intent=email_change&next=${encodeURIComponent(
            "/settings/account/email"
          )}`,
        }
      );

      if (error) {
        if (isRateLimitErrorMessage(error.message)) {
          const cooldownMs = getCooldownMsFromRateLimitErrorMessage(error.message, {
            fallbackMs: 10 * 60_000,
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

      // Prevent accidental double-sends while testing.
      const until = Date.now() + 60_000;
      setCooldownUntil(until);
      try {
        window.localStorage.setItem(cooldownKey, String(until));
      } catch {
        // ignore
      }

      setSuccessMsg(
        "Verification sent. Please check your inbox and confirm the email change."
      );
    } catch (err) {
      const msg = getErrorMessage(err);
      if (isRateLimitErrorMessage(msg)) {
        const cooldownMs = getCooldownMsFromRateLimitErrorMessage(msg, {
          fallbackMs: 10 * 60_000,
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
          <div className="acc-title">Change Email</div>
        </div>

        <div className="acc-inner">
          <div className="acc-editForm">
            <div className="acc-editRow">
              <div className="acc-editLabel">Current email</div>
              <div className="acc-editValue">{currentEmail || "-"}</div>
            </div>

            <form onSubmit={handleSubmit} className="acc-editFormBody">
              <label className="acc-editLabel" htmlFor="new-email">
                New email
              </label>
              <input
                id="new-email"
                type="email"
                className="acc-editInput"
                placeholder="Enter your new email address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={loading || inCooldown || isGoogleOnly}
                autoComplete="email"
                required
              />

              <div className="acc-editHelp">
                We’ll send a verification link to your new email. Your email won’t
                change until you confirm it.
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="acc-editBtnPrimary"
                  disabled={loading || inCooldown || isGoogleOnly}
                >
                  {loading
                    ? "Sending…"
                    : inCooldown
                    ? `Wait ${formatSeconds(remainingMs / 1000)}`
                    : isGoogleOnly
                    ? "Google Account"
                    : "Send Verification"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountEmailPage({ session, isAdmin, sidebarVariant }: Props) {
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
            <AccountEmailCard session={session} />
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
            <AccountEmailCard session={session} />
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <AskVoxStarBackground />
      <AccountEmailCard session={session} />
    </>
  );
}

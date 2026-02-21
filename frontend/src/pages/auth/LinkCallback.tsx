import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";

function safeNextPath(nextRaw: string | null, fallback: string): string {
  const next = (nextRaw || "").trim();
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}

export default function LinkCallback() {
  const nav = useNavigate();
  const loc = useLocation();

  const [msg, setMsg] = useState<string>("Finishing…");

  useEffect(() => {
    let cancelled = false;

    const parseParams = (raw: string) => {
      const cleaned = (raw || "").startsWith("#") ? raw.slice(1) : raw;
      return new URLSearchParams(cleaned);
    };

    const asOtpType = (raw: string | null):
      | "signup"
      | "invite"
      | "magiclink"
      | "recovery"
      | "email_change"
      | null => {
      const v = (raw || "").toLowerCase();
      if (v === "signup" || v === "invite" || v === "magiclink" || v === "recovery" || v === "email_change") {
        return v;
      }
      return null;
    };

    const run = async () => {
      const params = new URLSearchParams(loc.search);
      const hashParams = parseParams(loc.hash);

      const code = params.get("code");
      const tokenHash = params.get("token_hash") || hashParams.get("token_hash");
      const typeRaw = params.get("type") || hashParams.get("type");
      const otpType = asOtpType(typeRaw);

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      const intent = (params.get("intent") || otpType || "").toLowerCase();
      const next = safeNextPath(params.get("next"), "/settings/account/email");

      try {
        const errorFromProvider = params.get("error_description") || params.get("error");
        if (errorFromProvider) {
          setMsg(errorFromProvider);
          return;
        }

        // Supabase can redirect back in several shapes depending on auth flow:
        // - PKCE: ?code=...
        // - Implicit: #access_token=...&refresh_token=...
        // - OTP verify: ?token_hash=...&type=...
        setMsg("Verifying link…");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg(error.message || "This link is invalid or expired.");
            return;
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            setMsg(error.message || "This link is invalid or expired.");
            return;
          }
        } else if (tokenHash && otpType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });
          if (error) {
            setMsg(error.message || "This link is invalid or expired.");
            return;
          }
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;

        if (!session?.user) {
          setMsg("Please sign in again to continue.");
          nav("/login", { replace: true });
          return;
        }

        // Fetch the freshest user object (session.user can be stale)
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user ?? session.user;

        // Best-effort: keep profiles.email in sync with auth email.
        try {
          const email = user.email ?? null;
          if (email) {
            await supabase.from("profiles").update({ email }).eq("id", user.id);
            window.dispatchEvent(new Event("askvox:profile-updated"));
          }
        } catch {
          // ignore
        }

        const url = new URL(window.location.origin + next);
        if (intent === "email_change") url.searchParams.set("notice", "email_changed");

        if (!cancelled) {
          setMsg("Done. Redirecting…");
          nav(url.pathname + url.search, { replace: true });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMsg(message || "Something went wrong.");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loc.hash, loc.search, nav]);

  return (
    <div
      style={{
        color: "#fff",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      {msg}
    </div>
  );
}

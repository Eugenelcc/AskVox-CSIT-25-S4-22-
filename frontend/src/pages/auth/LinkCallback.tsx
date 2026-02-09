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

    const run = async () => {
      const params = new URLSearchParams(loc.search);
      const code = params.get("code");
      const intent = (params.get("intent") || "").toLowerCase();
      const next = safeNextPath(params.get("next"), "/settings/account/email");

      try {
        if (code) {
          setMsg("Verifying link…");
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg(error.message || "This link is invalid or expired.");
            return;
          }
        }

        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!session?.user) {
          setMsg("Please sign in again to continue.");
          nav("/login", { replace: true });
          return;
        }

        // Best-effort: keep profiles.email in sync with auth email.
        try {
          const email = session.user.email ?? null;
          if (email) {
            await supabase.from("profiles").update({ email }).eq("id", session.user.id);
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
  }, [loc.search, nav]);

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

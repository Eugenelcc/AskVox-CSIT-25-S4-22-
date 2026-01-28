import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";

export default function OAuthCallback() {
  const nav = useNavigate();
  const loc = useLocation();
  const [msg, setMsg] = useState<string>("Finishing sign-in…");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const params = new URLSearchParams(loc.search);
      const intent = (params.get("intent") || "").toLowerCase();

      const { data: sess } = await supabase.auth.getSession();
      const session = sess.session;
      if (!session?.user) {
        nav("/login", { replace: true });
        return;
      }

      const userId = session.user.id;

      // Check if a profile exists and whether signup is complete (learning_preference set)
      const { data: prof, error } = await supabase
        .from("profiles")
        .select("id, learning_preference")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (intent === "login") {
        if (error || !prof?.id) {
          // Not an existing customer for Login: sign out and send back with error
          setMsg("Account does not exist for this Google account.");
          try { await supabase.auth.signOut(); } catch {}
          nav("/login?err=account_not_found", { replace: true });
          return;
        }
        // Existing profile but signup incomplete → force user to go to Sign Up
        const pref = (prof.learning_preference ?? "").toString().trim().toLowerCase();
        const hasPref = (pref === "secondary" || pref === "tertiary" || pref === "university" || pref === "leisure");
        if (!hasPref) {
          // Signup not fully completed -> keep session and send to onboarding
          setMsg("Redirecting to onboarding…");
          nav("/onboarding/preferences", { replace: true });
          return;
        }
        nav("/newchat", { replace: true });
        return;
      }

      // intent === register OR unknown → allow, then route to onboarding/newchat
      if (!prof?.id) {
        // New user: show onboarding if configured; otherwise go to newchat
        nav("/onboarding/preferences", { replace: true });
      } else {
        nav("/newchat", { replace: true });
      }
    };
    run();
    return () => { cancelled = true; };
  }, [loc.search, nav]);

  return (
    <div style={{ color: "#fff", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {msg}
    </div>
  );
}

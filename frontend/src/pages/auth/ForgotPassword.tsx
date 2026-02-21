import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate, Link } from "react-router-dom";
import Background from "../../components/background/background";
import AskVoxLogo from "../../components/TopBars/AskVox.png";
import styles from "../cssfiles/Login.module.css"; // ✅ reuse your login css
import {
  getCooldownMsFromRateLimitErrorMessage,
  isRateLimitErrorMessage,
} from "../../utils/rateLimit";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cooldownKey = useMemo(() => "askvox:forgotPasswordCooldown", []);
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

  const formatSeconds = (s: number): string => {
    const n = Math.max(0, Math.ceil(s));
    const mm = Math.floor(n / 60);
    const ss = n % 60;
    if (mm <= 0) return `${ss}s`;
    return `${mm}m ${String(ss).padStart(2, "0")}s`;
  };

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

  const navigate = useNavigate();

  const handleCancel = () => navigate("/login"); // or "/"

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setMsg(null);

    if (inCooldown) {
      setErrorMsg(`Please wait ${formatSeconds(remainingMs / 1000)} before trying again.`);
      return;
    }

    if (!email.trim()) {
      setErrorMsg("Please enter your email address.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    //  do not confirm if email exists or not
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

    setMsg("If an account exists for this email, a password reset link has been sent. Please check your inbox.");
  };

  return (
    <div className={styles.pageRoot}>
      <Background />

      <div className={styles.loginContainer}>
        <div className={styles.loginForm}>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleCancel}
            aria-label="Close"
          >
            ✕
          </button>

          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />

          <h2 className={styles.title}>FORGOT PASSWORD</h2>
          <p className={styles.subtitle}>Enter your email and we’ll send you a reset link</p>

          <form onSubmit={handleSend} className={styles.form}>
            <div>
              <label className={styles.label}>Email Address:</label>
              <input
                type="email"
                placeholder="Enter your email address ..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                required
              />
            </div>

            {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}
            {msg && <p className={styles.successText}>{msg}</p>}

            <button
              type="submit"
              disabled={loading || inCooldown}
              className={styles.signInButton}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? "SENDING..."
                : inCooldown
                ? `WAIT ${formatSeconds(remainingMs / 1000)}`
                : "SEND RESET LINK"}
            </button>
          </form>

          <p className={styles.signUpText}>
            Remembered your password?{" "}
            <Link to="/login" className={styles.signUpLink}>
              Back to Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

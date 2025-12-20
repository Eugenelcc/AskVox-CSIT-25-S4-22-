import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import Background from "../../components/background/background";
import AskVoxLogo from "../../components/TopBars/AskVox.png";
import styles from "../cssfiles/Login.module.css";
import { Eye, EyeOff } from "lucide-react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const navigate = useNavigate();

  // ✅ Ensure user actually came from recovery link
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      // If user has a session, allow update password.
      // If not, they probably opened /reset-password directly without link.
      if (!data.session) {
        setErrorMsg("Your reset link is invalid or expired. Please request a new one.");
        setReady(false);
        return;
      }

      setReady(true);
    };

    check();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      // Supabase emits PASSWORD_RECOVERY in many setups
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleCancel = () => navigate("/login");

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!ready) return;

    if (password.trim().length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // Optional: sign out so they login fresh
    await supabase.auth.signOut();

    navigate("/login", { replace: true });
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

          <h2 className={styles.title}>RESET PASSWORD</h2>
          <p className={styles.subtitle}>Enter a new password for your account</p>

          <form onSubmit={handleUpdate} className={styles.form}>
            <div>
              <label className={styles.label}>New Password:</label>
              <div className={styles.passwordField}>
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="Enter your new password ..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${styles.input} ${styles.passwordInput}`}
                  required
                  disabled={!ready}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  disabled={!ready}
                >
                  {showPass ? <EyeOff size={22} /> : <Eye size={22} />}
                </button>
              </div>
            </div>

            <div>
              <label className={styles.label}>Confirm New Password:</label>
              <div className={styles.passwordField}>
                <input
                  type={showConfirm ? "text" : "password"}
                  placeholder="Enter your new password again ..."
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={`${styles.input} ${styles.passwordInput}`}
                  required
                  disabled={!ready}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  disabled={!ready}
                >
                  {showConfirm ? <EyeOff size={22} /> : <Eye size={22} />}
                </button>
              </div>
            </div>

            {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}

            <button
              type="submit"
              disabled={loading || !ready}
              className={styles.signInButton}
              style={{ opacity: loading || !ready ? 0.7 : 1 }}
            >
              {loading ? "UPDATING..." : "UPDATE PASSWORD"}
            </button>
          </form>

          {!ready && (
            <p className={styles.subtitle} style={{ marginTop: 10 }}>
              Tip: request a new reset link from “Forgot password”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

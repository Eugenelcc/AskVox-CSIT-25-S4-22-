import { useState, type FormEvent } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate, Link } from "react-router-dom";
import Background from "../../components/background/background";
import AskVoxLogo from "../../components/TopBars/AskVox.png";
import styles from "../cssfiles/Login.module.css"; // ✅ reuse your login css

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleCancel = () => navigate("/login"); // or "/"

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setMsg(null);

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
      setErrorMsg(error.message);
      return;
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
              disabled={loading}
              className={styles.signInButton}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "SENDING..." : "SEND RESET LINK"}
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

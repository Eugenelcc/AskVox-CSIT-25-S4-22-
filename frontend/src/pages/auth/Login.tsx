import { useState, type FormEvent } from "react";
import { supabase } from "../../supabaseClient";
import { Link, useNavigate } from "react-router-dom";
import Background from "../../components/background/background";
import AskVoxLogo from "../../components/TopBars/AskVox.png";
import styles from "../cssfiles/Login.module.css";

import GoogleLogo from "./Google.png";
import { Eye, EyeOff } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }

    // ✅ FETCH ROLE FROM profiles TABLE
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      console.error(profileError);
      setErrorMsg("Failed to load user profile.");
      setLoading(false);
      return;
    }

    setLoading(false);

    // ✅ ROLE-BASED REDIRECT
    if (profile.role === "educational_user") {
      navigate("/educationalinstutiaonal/homepage");
    } else {
      navigate("/reguserhome");
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // ✅ redirect back to login so role routing still applies
        redirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) setErrorMsg(error.message);
  };

  const handleCancel = () => {
    navigate("/");
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

          <h2 className={styles.title}>WELCOME BACK</h2>
          <p className={styles.subtitle}>Please enter your details</p>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className={styles.googleButton}
            disabled={loading}
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            <img src={GoogleLogo} alt="Google" className={styles.googleLogo} />
            Sign in with Google
          </button>

          <div className={styles.divider}>
            <div className={styles.dividerLine} />
            <span className={styles.dividerText}>or</span>
            <div className={styles.dividerLine} />
          </div>

          <form onSubmit={handleLogin} className={styles.form}>
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

            <div>
              <label className={styles.label}>Password:</label>
              <div className={styles.passwordField}>
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="Enter your password ..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${styles.input} ${styles.passwordInput}`}
                  required
                />

                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPass((v) => !v)}
                >
                  {showPass ? <EyeOff size={22} /> : <Eye size={22} />}
                </button>
              </div>
            </div>

            <div className={styles.rememberForgot}>
              <label className={styles.rememberLabel}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>

              <Link to="/forgot-password" className={styles.forgotLink}>
                Forgot your password?
              </Link>
            </div>

            {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}

            <button
              type="submit"
              disabled={loading}
              className={styles.signInButton}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "SIGNING IN..." : "SIGN IN"}
            </button>
          </form>

          <p className={styles.signUpText}>
            Don't have an account?{" "}
            <Link to="/register" className={styles.signUpLink}>
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

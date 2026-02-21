import { useMemo, useState, type FormEvent } from "react";
import { supabase } from "../../supabaseClient";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Background from "../../components/background/background";
import AskVoxLogo from "../../components/TopBars/AskVox.png";
import styles from "../cssfiles/Login.module.css";

import GoogleLogo from "./Google.png";
import { Eye, EyeOff } from "lucide-react";

//type UserRole = "registered" | "paid";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Display error coming from OAuth callback (e.g., account not found)
  const oauthErrorMsg = useMemo(() => {
    const p = new URLSearchParams(location.search);
    const err = p.get("err");
    if (err === "account_not_found") {
      return "Account does not exist for the selected Google account. Please sign up first.";
    }
    if (err === "complete_signup_first") {
      return "Please complete sign up with Google first, then sign in.";
    }
    return null;
  }, [location.search]);

  const displayErrorMsg = errorMsg ?? oauthErrorMsg;

  const routeByRole = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) {
        navigate("/newchat");
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      const roleValue = (prof as Record<string, unknown> | null)?.role;
      const role = (typeof roleValue === "string" ? roleValue : "").trim().toLowerCase();
      if (role === "platform_admin") {
        navigate("/platformadmin/dashboard");
        return;
      }
      if (role === "educational_user") {
        navigate("/educationInstitutional");
        return;
      }

      navigate("/newchat");
    } catch {
      navigate("/newchat");
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    setLoading(true);

    const {  error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }

    // ✅ Role (placeholder) – later fetch from profiles table / metadata
    // const role: UserRole =
    //   (data.user?.user_metadata?.role as UserRole) || "registered";

    // Remember me: Supabase persists session by default.
    setLoading(false);
    await routeByRole();
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/oauth-callback?intent=login`,
        queryParams: { prompt: "select_account" },
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
          {/* Cancel / Close */}
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

              {/* ✅ password field same size as email + icon inside */}
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
                  aria-label={showPass ? "Hide password" : "Show password"}
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

            {displayErrorMsg && <p className={styles.errorText}>{displayErrorMsg}</p>}

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

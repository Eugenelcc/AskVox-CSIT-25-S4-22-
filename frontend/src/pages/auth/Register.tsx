import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "../../supabaseClient";
import { Link, useNavigate } from "react-router-dom";
import styles from "../cssfiles/Register.module.css";
import Background from "../../components/background/background";
import AskVoxLogo from "../../components/TopBars/AskVox.png";
import { Eye, EyeOff } from "lucide-react";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  //  Fields
  const [gender, setGender] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");

  // Profile picture 
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const navigate = useNavigate();

  const [showPass, setShowPass] = useState(false);


  const avatarPreviewUrl = useMemo(() => {
    if (!avatarFile) return "";
    return URL.createObjectURL(avatarFile);
  }, [avatarFile]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  const openFilePicker = () => fileInputRef.current?.click();

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (!f) return;

    // simple guard: allow images only
    if (!f.type.startsWith("image/")) {
      alert("Please upload an image file (jpg, png, etc).");
      e.target.value = "";
      return;
    }

    setAvatarFile(f);
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // DOB formatting (pad month/day to 2 digits)
    const mm = birthMonth ? String(birthMonth).padStart(2, "0") : "";
    const dd = birthDay ? String(birthDay).padStart(2, "0") : "";
    const dob = birthYear && mm && dd ? `${birthYear}-${mm}-${dd}` : "";

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirmed`,
        data: {
          full_name: username,
          username: username,
          gender: gender,
          dob: dob,
          // we’ll update avatar_url if upload succeeds below
          avatar_url: null,
        },
      },
    });

    if (error) {
      // Show inline error instead of browser alert
      alert(error.message);
      setLoading(false);
      return;
    }

    // ✅ Optional: try upload avatar (won’t block registration if it fails)
    // Change "avatars" to your bucket name if different.
    try {
      const userId = data.user?.id;
      if (userId && avatarFile) {
        const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${userId}/avatar.${ext}`;

        const uploadRes = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });

        if (!uploadRes.error) {
          const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
          const publicUrl = pub?.publicUrl || null;

          // If user is not logged in yet (email confirm), updateUser may fail.
          // We still try, but ignore failures.
          await supabase.auth.updateUser({
            data: { avatar_url: publicUrl },
          });
        }
      }
    } catch {
      // ignore avatar upload errors (registration still succeeded)
    }

    // Navigate to a styled "check your email" page instead of a browser alert
    navigate("/auth/check-email");
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/reguserhome` },
    });
    if (error) alert(error.message);
  };

  // Helpers for Date Dropdowns
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const years = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className={styles.pageRoot}>
      <Background />

      <div className={`${styles.registerContainer} uv-responsive-container`}>
        <div className={`${styles.registerForm} uv-responsive-form`}>
          {/* To close */}
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close"
            onClick={() => navigate("/")}
            title="Close"
          >
            ×
          </button>

          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />

          <h2 className={`${styles.title} uv-responsive-text`}>Sign up for free</h2>
          <p className={styles.subtitle}>Your journey with AskVox starts here.</p>

          {/* ✅ Profile picture picker */}
          <div className={styles.avatarRow}>
            <div className={styles.avatarCircle} onClick={openFilePicker} role="button" tabIndex={0}>
              {avatarPreviewUrl ? (
                <img src={avatarPreviewUrl} alt="Profile preview" className={styles.avatarImg} />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  <span className={styles.avatarPlus}>+</span>
                </div>
              )}

              <button
                type="button"
                className={styles.avatarEditBtn}
                onClick={(ev) => {
                  ev.stopPropagation();
                  openFilePicker();
                }}
                aria-label="Edit profile picture"
                title="Edit"
              >
                ✎
              </button>
            </div>

            <div className={styles.avatarText}>
              <div className={styles.avatarTitle}>Profile picture</div>
              <div className={styles.avatarHint}>Tap to upload (optional)</div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onAvatarChange}
              className={styles.avatarInput}
            />
          </div>

          <button onClick={handleGoogleLogin} className={styles.googleButton} disabled={loading}>
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt="Google"
              className={styles.googleLogo}
            />
            Sign up with Google
          </button>

          <div className={styles.divider}>
            <div className={styles.dividerLine}></div>
            <span className={styles.dividerText}>or</span>
            <div className={styles.dividerLine}></div>
          </div>

          <form onSubmit={handleRegister} className={styles.form}>
            <div>
              <label className={styles.label}>Profile Name:</label>
              <input
                type="text"
                placeholder="Enter your profile name ..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={styles.input}
                required
              />
            </div>

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
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? <EyeOff size={22} /> : <Eye size={22} />}
                </button>
              </div>
            </div>

            {/* Gender Selection */}
            <div>
              <label className={styles.label}>What's your gender?</label>
              <div className={`${styles.genderGroup} uv-stack-on-mobile`}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="gender"
                    value="female"
                    onChange={(e) => setGender(e.target.value)}
                    className={styles.radio}
                  />{" "}
                  Female
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="gender"
                    value="male"
                    onChange={(e) => setGender(e.target.value)}
                    className={styles.radio}
                  />{" "}
                  Male
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="gender"
                    value="other"
                    onChange={(e) => setGender(e.target.value)}
                    className={styles.radio}
                  />{" "}
                  Rather not say
                </label>
              </div>
            </div>

            {/* Date of Birth Selection */}
            <div>
              <label className={styles.label}>What's your date of birth?</label>
              <div className={`${styles.dobGroup} uv-stack-on-mobile`}>
                <select
                  className={`${styles.select} uv-full-width-mobile`}
                  value={birthMonth}
                  onChange={(e) => setBirthMonth(e.target.value)}
                  required
                >
                  <option value="">Month</option>
                  {months.map((m, i) => (
                    <option key={i} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>

                <select
                  className={`${styles.select} uv-full-width-mobile`}
                  value={birthDay}
                  onChange={(e) => setBirthDay(e.target.value)}
                  required
                >
                  <option value="">Day</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <select
                  className={`${styles.select} uv-full-width-mobile`}
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  required
                >
                  <option value="">Year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" disabled={loading} className={styles.submitButton}>
              {loading ? "CREATING ACCOUNT..." : "SIGN UP"}
            </button>
          </form>

          <p className={styles.loginText}>
            Already have an account?{" "}
            <Link to="/login" className={styles.loginLink}>
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
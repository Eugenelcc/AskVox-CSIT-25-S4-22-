import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import "./cssfiles/AccountDetails.css";
import { isGoogleOauthOnlyAccount } from "../../utils/authProviders";

type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  gender: string | null;
  dob: string | null;
  avatar_url: string | null; // URL or storage path
  learning_preference?: string | null;
};

export default function AccountDetails({ session }: { session: Session }) {
  const navigate = useNavigate();
  const userId = session.user.id;

  const isGoogleOnly = useMemo(() => isGoogleOauthOnlyAccount(session.user), [session.user]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarSrc, setAvatarSrc] = useState<string>("");

  // Profile Name modal
  const [openNameModal, setOpenNameModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Gender modal
  const [openGenderModal, setOpenGenderModal] = useState(false);
  const [draftGender, setDraftGender] = useState<string>("");
  const [savingGender, setSavingGender] = useState(false);
  const [genderError, setGenderError] = useState<string | null>(null);

  // DOB modal
  const [openDobModal, setOpenDobModal] = useState(false);
  const [draftDob, setDraftDob] = useState<string>(""); // YYYY-MM-DD
  const [savingDob, setSavingDob] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);

  // Learning Preference editing handled via onboarding page UI

  // Load profile
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Failed to load profile:", error.message);
        return;
      }

      if (cancelled) return;
      setProfile(data as Profile);
    };

    load();

    const onProfileUpdated = () => {
      void load();
    };

    window.addEventListener("askvox:profile-updated", onProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("askvox:profile-updated", onProfileUpdated);
    };
  }, [userId]);

  // Load avatar (URL direct OR signed URL if private storage path)
  useEffect(() => {
    let cancelled = false;

    const loadAvatar = async () => {
      const v = profile?.avatar_url || "";
      if (!v) {
        setAvatarSrc("");
        return;
      }

      // http/https URL
      if (/^https?:\/\//i.test(v)) {
        setAvatarSrc(v);
        return;
      }

      // storage path in private bucket
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(v, 60 * 60 * 24 * 7);

      if (cancelled) return;

      if (error) {
        console.warn("avatar signed url error:", error.message);
        setAvatarSrc("");
        return;
      }

      setAvatarSrc(data?.signedUrl ?? "");
    };

    loadAvatar();
    return () => {
      cancelled = true;
    };
  }, [profile?.avatar_url]);

  const dobPretty = useMemo(() => {
    if (!profile?.dob) return "-";
    const [y, m, d] = profile.dob.split("-");
    if (!y || !m || !d) return "-";
    return `${d}/${m}/${y}`;
  }, [profile?.dob]);

  // Open modal + preload value
  const openProfileNameModal = () => {
    setNameError(null);
    setDraftName(profile?.username ?? "");
    setOpenNameModal(true);
  };

  // Save profile name -> profiles.username
  const saveProfileName = async () => {
    if (!profile?.id) return;

    const v = draftName.trim();
    if (!v) {
      setNameError("Profile name cannot be empty.");
      return;
    }

    setSavingName(true);
    setNameError(null);

    const { error } = await supabase
      .from("profiles")
      .update({ username: v })
      .eq("id", profile.id);

    if (error) {
      setNameError(error.message);
      setSavingName(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, username: v } : prev));
    setSavingName(false);
    setOpenNameModal(false);
  };

  const openGender = () => {
    setGenderError(null);
    setDraftGender(profile?.gender ?? "");
    setOpenGenderModal(true);
  };

  const saveGender = async () => {
    if (!profile?.id) return;

    const v = (draftGender || "").trim();
    if (!v) {
      setGenderError("Please choose a gender.");
      return;
    }

    setSavingGender(true);
    setGenderError(null);

    const { error } = await supabase
      .from("profiles")
      .update({ gender: v })
      .eq("id", profile.id);

    if (error) {
      setGenderError(error.message);
      setSavingGender(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, gender: v } : prev));
    setSavingGender(false);
    setOpenGenderModal(false);
  };

  const openDob = () => {
    setDobError(null);
    setDraftDob(profile?.dob ?? "");
    setOpenDobModal(true);
  };

  const saveDob = async () => {
    if (!profile?.id) return;

    const v = (draftDob || "").trim();
    if (!v) {
      setDobError("Please choose your date of birth.");
      return;
    }

    setSavingDob(true);
    setDobError(null);

    const { error } = await supabase
      .from("profiles")
      .update({ dob: v })
      .eq("id", profile.id);

    if (error) {
      setDobError(error.message);
      setSavingDob(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, dob: v } : prev));
    setSavingDob(false);
    setOpenDobModal(false);
  };

  // Open full-page preference selector (shared UI)
  const openPref = () => {
    navigate("/onboarding/preferences");
  };

  return (
    <div className="acc-wrap">
      <div className="acc-card">
        <div className="acc-head">
          <div className="acc-titleRow">
            <div className="acc-title">Account Settings</div>
          </div>
        </div>

        <div className="acc-inner">
          {/* Avatar block */}
          <div className="acc-avatarBlock">
            <div className="acc-avatarRing">
              {avatarSrc ? (
                <img
                  className="acc-avatarImg"
                  src={avatarSrc}
                  alt="Avatar"
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                  onError={() => setAvatarSrc("")}
                />
              ) : (
                <div className="acc-avatarFallback" />
              )}
            </div>

            <button
              className="acc-editAvatarBtn"
              onClick={() => navigate("/settings/account/avatar")}
              aria-label="Edit avatar"
              title="Edit avatar"
              type="button"
            >
              <Pencil size={16} />
            </button>
          </div>

          {/* Rows */}
          <div className="acc-row">
            <div className="acc-label">Profile Name:</div>
            <div className="acc-value">{profile?.username ?? "-"}</div>
            <button
              className="acc-editBtn"
              type="button"
              onClick={openProfileNameModal}
              aria-label="Edit profile name"
              title="Edit profile name"
            >
              <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row">
            <div className="acc-label">Email Address:</div>
            <div className="acc-value">{profile?.email ?? session.user.email ?? "-"}</div>
            {!isGoogleOnly && (
              <button
                className="acc-editBtn"
                type="button"
                onClick={() => navigate("/settings/account/email")}
                aria-label="Edit email"
                title="Edit email"
              >
                <Pencil size={18} />
              </button>
            )}
          </div>

          <div className="acc-row">
            <div className="acc-label">Date of Birth:</div>
            <div className="acc-value">{dobPretty}</div>
            <button
                className="acc-editBtn"
                type="button"
                onClick={openDob}
                aria-label="Edit date of birth"
                title="Edit date of birth"
                >
                <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row">
            <div className="acc-label">Password:</div>
            <div className="acc-value">************************</div>
            {!isGoogleOnly && (
              <button
                className="acc-editBtn"
                type="button"
                onClick={() => navigate("/settings/account/password")}
                aria-label="Change password"
                title="Change password"
              >
                <Pencil size={18} />
              </button>
            )}
          </div>

          <div className="acc-row acc-row--gender">
            <div className="acc-label">Gender:</div>
            <div className="acc-value">{profile?.gender ?? "-"}</div>
            <button
                className="acc-editBtn"
                type="button"
                onClick={openGender}
                aria-label="Edit gender"
                title="Edit gender"
            >
                <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row">
            <div className="acc-label">Learning Preference:</div>
            <div className="acc-value">{(profile?.learning_preference ?? "leisure").toLowerCase()}</div>
            <button
              className="acc-editBtn"
              type="button"
              onClick={openPref}
              aria-label="Edit learning preference"
              title="Edit learning preference"
            >
              <Pencil size={18} />
            </button>
          </div>
        </div>

        {/* Modals inside account card */}
        {openNameModal && (
          <div
            className="acc-modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label="Edit Profile Name"
          >
            <div className="acc-modal">
              <button
                className="acc-modalClose"
                type="button"
                onClick={() => setOpenNameModal(false)}
                aria-label="Close"
                title="Close"
              >
                ×
              </button>

              <div className="acc-modalTitle">Enter New Profile Name:</div>

              <input
                className="acc-modalInput"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Enter your new profile name..."
              />

              {nameError && <div className="acc-modalError">{nameError}</div>}

              <button
                className="acc-modalSave"
                type="button"
                onClick={saveProfileName}
                disabled={savingName}
              >
                {savingName ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {openGenderModal && (
          <div
            className="acc-modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label="Edit Gender"
          >
            <div className="acc-modal">
              <button
                className="acc-modalClose"
                type="button"
                onClick={() => setOpenGenderModal(false)}
                aria-label="Close"
                title="Close"
              >
                ×
              </button>

              <div className="acc-modalTitle">Choose your gender</div>

              <div className="acc-radioGroup">
                <label className="acc-radio">
                  <input
                    type="radio"
                    name="gender"
                    value="female"
                    checked={draftGender === "female"}
                    onChange={(e) => setDraftGender(e.target.value)}
                  />
                  <span className="acc-radioLabel">Female</span>
                </label>

                <label className="acc-radio">
                  <input
                    type="radio"
                    name="gender"
                    value="male"
                    checked={draftGender === "male"}
                    onChange={(e) => setDraftGender(e.target.value)}
                  />
                  <span className="acc-radioLabel">Male</span>
                </label>

                <label className="acc-radio">
                  <input
                    type="radio"
                    name="gender"
                    value="other"
                    checked={draftGender === "other"}
                    onChange={(e) => setDraftGender(e.target.value)}
                  />
                  <span className="acc-radioLabel">Rather not say</span>
                </label>
              </div>

              {genderError && <div className="acc-modalError">{genderError}</div>}

              <button
                className="acc-modalSave"
                type="button"
                onClick={saveGender}
                disabled={savingGender}
              >
                {savingGender ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {openDobModal && (
          <div
            className="acc-modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label="Edit Date of Birth"
          >
            <div className="acc-modal">
              <button
                className="acc-modalClose"
                type="button"
                onClick={() => setOpenDobModal(false)}
                aria-label="Close"
                title="Close"
              >
                ×
              </button>

              <div className="acc-modalTitle">Choose your Date of Birth:</div>

              <input
                className="acc-dateInput"
                type="date"
                value={draftDob}
                onChange={(e) => setDraftDob(e.target.value)}
              />

              {dobError && <div className="acc-modalError">{dobError}</div>}

              <button
                className="acc-modalSave"
                type="button"
                onClick={saveDob}
                disabled={savingDob}
              >
                {savingDob ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Preference editing now uses the full-page onboarding UI */}
      </div>
    </div>
  );
}

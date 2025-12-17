import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import "./cssfiles/AccountDetails.css";

type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  gender: string | null;
  dob: string | null;
  avatar_url: string | null; // can be URL or storage path
};

export default function AccountDetails({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarSrc, setAvatarSrc] = useState<string>("");

  const userId = session.user.id;

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
      if (error) {
        console.error(error);
        return;
      }
      setProfile(data);
    };
    load();
  }, [userId]);

  // display avatar (URL direct or signed URL if storage path + private bucket)
  useEffect(() => {
    let cancelled = false;

    const loadAvatar = async () => {
      const v = profile?.avatar_url || "";
      if (!v) {
        setAvatarSrc("");
        return;
      }

      if (/^https?:\/\//i.test(v)) {
        setAvatarSrc(v);
        return;
      }

      const { data, error } = await supabase.storage.from("avatars").createSignedUrl(v, 60 * 60 * 24 * 7);
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
    // expecting YYYY-MM-DD
    const [y, m, d] = profile.dob.split("-");
    return `${d}/${m}/${y}`;
  }, [profile?.dob]);

  return (
    <div className="acc-wrap">
      <div className="acc-card">
        <div className="acc-head">
          <div className="acc-titleRow">
            <div className="acc-title">Account</div>
          </div>
        </div>

        <div className="acc-inner">
          {/* Avatar block */}
          <div className="acc-avatarBlock">
            <div className="acc-avatarRing">
              {avatarSrc ? (
                <img className="acc-avatarImg" src={avatarSrc} alt="Avatar" />
              ) : (
                <div className="acc-avatarFallback" />
              )}
            </div>

            <button className="acc-editAvatarBtn" onClick={() => navigate("/settings/account/avatar")} aria-label="Edit avatar">
              <Pencil size={16} />
            </button>
          </div>

          {/* Rows */}
          <div className="acc-row">
            <div className="acc-label">Profile Name:</div>
            <div className="acc-value">{profile?.username ?? "-"}</div>
            <button className="acc-editBtn" onClick={() => navigate("/settings/account/name")} aria-label="Edit profile name">
              <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row">
            <div className="acc-label">Email Address:</div>
            <div className="acc-value">{profile?.email ?? session.user.email ?? "-"}</div>
            <button className="acc-editBtn" onClick={() => navigate("/settings/account/email")} aria-label="Edit email">
              <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row">
            <div className="acc-label">Date of Birth:</div>
            <div className="acc-value">{dobPretty}</div>
            <button className="acc-editBtn" onClick={() => navigate("/settings/account/dob")} aria-label="Edit date of birth">
              <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row">
            <div className="acc-label">Password:</div>
            <div className="acc-value">************************</div>
            <button className="acc-editBtn" onClick={() => navigate("/settings/account/password")} aria-label="Change password">
              <Pencil size={18} />
            </button>
          </div>

          <div className="acc-row acc-row--gender">
            <div className="acc-label">Gender:</div>
            <div className="acc-value">{profile?.gender ?? "-"}</div>
            <button className="acc-editBtn" onClick={() => navigate("/settings/account/gender")} aria-label="Edit gender">
              <Pencil size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

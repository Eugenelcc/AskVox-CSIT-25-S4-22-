import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import AskVoxStarBackground from "../../components/background/background";
import AdminNavRail from "../../components/Sidebar/AdminNavRail";
import { supabase } from "../../supabaseClient";
import "./cssfiles/AccountDetails.css";
import "./cssfiles/AccountEdit.css";
import "./cssfiles/AccountAvatar.css";

const PROFILE_UPDATED_EVENT = "askvox:profile-updated";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isImageFile(f: File): boolean {
  return !!f.type && f.type.startsWith("image/");
}

function getFileExt(f: File): string {
  const byName = f.name.split(".").pop()?.toLowerCase();
  if (byName) return byName;
  const byType = f.type.split("/").pop()?.toLowerCase();
  return byType || "png";
}

interface Props {
  session: Session;
  isAdmin: boolean;
}

const ICONS: Array<{ id: string; src: string }> = [
  { id: "av-1", src: "/assets/avatars/av-1.svg" },
  { id: "av-2", src: "/assets/avatars/av-2.svg" },
  { id: "av-3", src: "/assets/avatars/av-3.svg" },
  { id: "av-4", src: "/assets/avatars/av-4.svg" },
  { id: "av-5", src: "/assets/avatars/av-5.svg" },
  { id: "av-6", src: "/assets/avatars/av-6.svg" },
  { id: "av-7", src: "/assets/avatars/av-7.svg" },
  { id: "av-8", src: "/assets/avatars/av-8.svg" },
];

export function AccountAvatarCard({ session }: { session: Session }) {
  const navigate = useNavigate();
  const userId = session.user.id;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedIconSrc, setSelectedIconSrc] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const uploadPreviewUrl = useMemo(() => {
    if (!uploadFile) return "";
    return URL.createObjectURL(uploadFile);
  }, [uploadFile]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);

  const openFilePicker = () => fileInputRef.current?.click();

  const onPickUpload = (f: File | null) => {
    if (!f) return;
    if (!isImageFile(f)) {
      setErrorMsg("Please upload an image file (jpg, png, etc). ");
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploadFile(f);
    setSelectedIconSrc("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedIconSrc && !uploadFile) {
      setErrorMsg("Please choose an icon or upload an image.");
      return;
    }

    setLoading(true);

    try {
      let avatarValue: string;

      if (uploadFile) {
        const ext = getFileExt(uploadFile);
        const path = `${userId}/avatar.${ext}`;

        const uploadRes = await supabase.storage
          .from("avatars")
          .upload(path, uploadFile, { upsert: true });

        if (uploadRes.error) {
          setErrorMsg(uploadRes.error.message);
          return;
        }

        // Store as STORAGE PATH so private buckets still work via signed URLs.
        avatarValue = path;
      } else {
        // Store icon as absolute URL so it's directly renderable.
        avatarValue = `${window.location.origin}${selectedIconSrc}`;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarValue })
        .eq("id", userId);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      // Best-effort: keep auth metadata in sync (NavRail fallback uses this too).
      try {
        await supabase.auth.updateUser({
          data: { avatar_url: avatarValue },
        });
      } catch {
        // ignore
      }

      setSuccessMsg("Profile picture updated.");
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
      navigate("/settings/account");
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="acc-wrap">
      <div className="acc-card">
        <div className="acc-head">
          <div className="acc-title">Account</div>
        </div>

        <div className="acc-inner">
          <div className="acc-editForm">
            <div className="acc-editRow">
              <div className="acc-editLabel">Profile picture</div>
              <div className="acc-editValue">Choose an icon or upload your own</div>
            </div>

            <form onSubmit={onSubmit} className="acc-editFormBody">
              <div className="acc-avatarPicker">
                <div className="acc-avatarPicker__title">Choose a Profile Picture icon:</div>
                <div className="acc-avatarGrid" role="list">
                  {ICONS.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className={`acc-avatarOption ${selectedIconSrc === it.src ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedIconSrc(it.src);
                        setUploadFile(null);
                        setErrorMsg(null);
                        setSuccessMsg(null);
                      }}
                      aria-pressed={selectedIconSrc === it.src}
                    >
                      <img src={it.src} alt="" />
                    </button>
                  ))}
                </div>

                <div className="acc-avatarPicker__title">Or upload your own:</div>
                <div className="acc-uploadRow">
                  <button
                    type="button"
                    className="acc-editBtnSecondary"
                    onClick={openFilePicker}
                    disabled={loading}
                  >
                    Choose file
                  </button>
                  <input
                    ref={fileInputRef}
                    className="acc-uploadInput"
                    type="file"
                    accept="image/*"
                    onChange={(e) => onPickUpload(e.target.files?.[0] ?? null)}
                    disabled={loading}
                  />
                </div>

                {uploadPreviewUrl && (
                  <div className="acc-editHelp">Preview:</div>
                )}
                {uploadPreviewUrl && (
                  <div>
                    <img
                      src={uploadPreviewUrl}
                      alt="Upload preview"
                      style={{ width: 96, height: 96, borderRadius: 18, border: "1px solid rgba(255,255,255,0.12)" }}
                    />
                  </div>
                )}

                {errorMsg && (
                  <div className="acc-editAlert acc-editAlert--error">{errorMsg}</div>
                )}
                {successMsg && (
                  <div className="acc-editAlert acc-editAlert--success">{successMsg}</div>
                )}

                <div className="acc-editActions">
                  <button
                    type="button"
                    className="acc-editBtnSecondary"
                    onClick={() => navigate("/settings/account")}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="acc-editBtnPrimary"
                    disabled={loading}
                  >
                    {loading ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountAvatarPage({ session, isAdmin }: Props) {
  const navigate = useNavigate();

  if (isAdmin) {
    return (
      <>
        <AskVoxStarBackground />
        <div className="admin-wrap admin-layout">
          <aside className="admin-sidebar">
            <AdminNavRail onNavigate={(path) => navigate(path)} />
          </aside>
          <main>
            <AccountAvatarCard session={session} />
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <AskVoxStarBackground />
      <AccountAvatarCard session={session} />
    </>
  );
}

import { type FC } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Mic, MicOff } from "lucide-react";
import "./UnregisteredTopBar.css";
import AskVoxLogo from "./AskVox.png";

interface TopBarProps {
  session?: Session | null;
  micEnabled: boolean;
  onToggleMic: () => void;
}

const UnregisteredTopBar: FC<TopBarProps> = ({ session, micEnabled, onToggleMic }) => {
  const navigate = useNavigate();

  // Keep smart logo click (still uses session)
  const handleLogoClick = () => {
    if (session) navigate("/reguserhome"); 
    else navigate("/");
  };

  return (
    <header className="uv-topbar">
      <div className="uv-topbar-left">
        <img
          src={AskVoxLogo}
          alt="AskVox"
          className="uv-logo"
          onClick={handleLogoClick}
          style={{ cursor: "pointer" }}
        />
      </div>

      <div className="uv-topbar-right">
        <button
          className="uv-top-btn uv-top-btn-outline uv-top-btn-icon"
          type="button"
          onClick={onToggleMic}
          aria-pressed={micEnabled}
          title={micEnabled ? "Microphone enabled" : "Microphone disabled"}
        >
          {micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
          <span className="uv-top-btn-text">{micEnabled ? "Mic on" : "Mic off"}</span>
        </button>
        <button
          className="uv-top-btn uv-top-btn-outline"
          onClick={() => navigate("/register")}
        >
          Create account
        </button>

        <button
          className="uv-top-btn uv-top-btn-outline"
          onClick={() => navigate("/login")}
        >
          Log in
        </button>
      </div>
    </header>
  );
};

export default UnregisteredTopBar;

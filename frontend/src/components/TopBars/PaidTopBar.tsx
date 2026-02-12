import { type FC } from "react";
import { useNavigate } from "react-router-dom";
//import { supabase } from "../../supabaseClient";
import type { Session } from "@supabase/supabase-js";
import { Mic, MicOff } from "lucide-react";
import "./UnregisteredTopBar.css";

interface PaidTopBarProps {
  session?: Session | null;
  micEnabled: boolean;
  onToggleMic: () => void;
}

const PaidTopBar: FC<PaidTopBarProps> = ({ session, micEnabled, onToggleMic }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    // Navigate first to avoid route-guard redirection to /login for OAuth users
    navigate("/logout-success", { replace: true });
  };

  return (
    <header className="uv-topbar">
      <div className="uv-topbar-left" />
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
          onClick={handleLogout}
          disabled={!session}
          style={{ opacity: !session ? 0.6 : 1 }}
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default PaidTopBar;

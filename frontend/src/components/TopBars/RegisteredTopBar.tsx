import { type FC } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import type { Session } from "@supabase/supabase-js";
import "./UnregisteredTopBar.css";
import AskVoxLogo from "./AskVox.png";

interface RegisteredTopBarProps {
  session?: Session | null;
}

const RegisteredTopBar: FC<RegisteredTopBarProps> = ({ session }) => {
  const navigate = useNavigate();

  const handleLogoClick = () => {
    // logged-in home
    navigate("/registered");
  };

  const handleLogout = async () => {
    // Navigate away first 
    navigate("/");

    const { error } = await supabase.auth.signOut();
    if (error) console.error("Error logging out:", error);
  };

  const handleUpgrade = () => {
    
    navigate("/upgrade"); 
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
          className="uv-top-btn uv-top-btn-outline"
          onClick={handleUpgrade}
          disabled={!session}
          style={{ opacity: !session ? 0.6 : 1 }}
        >
          Upgrade
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

export default RegisteredTopBar;

import { type FC } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import type { Session } from "@supabase/supabase-js";
import "./UnregisteredTopBar.css";


interface RegisteredTopBarProps {
  session?: Session | null;
}

const RegisteredTopBar: FC<RegisteredTopBarProps> = ({ session }) => {
  const navigate = useNavigate();



  const handleLogout = async () => {
    // Navigate first to avoid protected-route redirects on auth state change
    navigate("/logout-success", { replace: true });
  };

  const handleUpgrade = () => {
    
    navigate("/upgrade"); 
  };

  return (
    <header className="uv-topbar">
      <div className="uv-topbar-left">
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

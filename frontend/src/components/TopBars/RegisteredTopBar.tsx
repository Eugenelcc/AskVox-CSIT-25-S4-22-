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
    // Sign out first to clear persisted session, then go to public landing
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      console.error("Error logging out:", error);
      return;
    }
    navigate("/", { replace: true });
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

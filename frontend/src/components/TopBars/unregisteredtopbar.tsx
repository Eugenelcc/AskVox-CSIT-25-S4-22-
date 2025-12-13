import { type FC } from "react";
import { useNavigate } from "react-router-dom"; 
import { supabase } from "../../supabaseClient";
import type { Session } from "@supabase/supabase-js";
import "./UnregisteredTopBar.css";
import AskVoxLogo from "./AskVox.png"; 

interface TopBarProps {
  session?: Session | null;
}

const UnregisteredTopBar: FC<TopBarProps> = ({ session }) => {
  const navigate = useNavigate();

  // ✅ NEW: Smart Redirect Logic
  const handleLogoClick = () => {
    if (session) {
      // If logged in, go to Dashboard
      navigate("/dashboard");
    } else {
      // If guest, go to Landing Page
      navigate("/");
    }
  };

  const handleLogout = async () => {
    // 1. Navigate away immediately (while session is still valid)
    navigate("/"); 
    
    // 2. Then kill the session
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Error logging out:", error);
  };

  return (
    <header className="uv-topbar">
      <div className="uv-topbar-left">
        <img 
          src={AskVoxLogo} 
          alt="AskVox" 
          className="uv-logo" 
          onClick={handleLogoClick} // ✅ Use the smart handler here
          style={{ cursor: "pointer" }}
        />
      </div>

      <div className="uv-topbar-right">
        {session ? (
          <>
            <button 
              className="uv-top-btn uv-top-btn-outline" 
              onClick={() => navigate("/dashboard")} 
            >
              Profile
            </button>
            <button 
              className="uv-top-btn uv-top-btn-outline" 
              onClick={handleLogout}
            >
              Logout
            </button>
          </>
        ) : (
          <>
          
            <button 
              className="uv-top-btn uv-top-btn-outline" 
              onClick={() => navigate("/register")} 
            >
              Create account for free
            </button>
            <button 
              className="uv-top-btn uv-top-btn-outline" 
              onClick={() => navigate("/login")}
            >
              Log in
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default UnregisteredTopBar;
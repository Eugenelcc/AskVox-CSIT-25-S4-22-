import { type FC } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import type { Session } from "@supabase/supabase-js";
import "./UnregisteredTopBar.css";

interface PaidTopBarProps {
  session?: Session | null;
}

const PaidTopBar: FC<PaidTopBarProps> = ({ session }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) {
        console.error("Error logging out:", error);
      }
    } finally {
      navigate("/logout-success", { replace: true });
    }
  };

  return (
    <header className="uv-topbar">
      <div className="uv-topbar-left" />
      <div className="uv-topbar-right">
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

import type { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import AskVoxStarBackground from "../../components/background/background";
import AdminNavRail from "../../components/Sidebar/AdminNavRail";
import AccountDetails from "./AccountDetails";
import "../admin/AdminDashboard.css";

interface Props {
  session: Session;
  isAdmin: boolean;
}

export default function AccountSettingsPage({ session, isAdmin }: Props) {
  const navigate = useNavigate();

  const handleLogout = () => {
    navigate("/logout-success");
  };

  // Platform admin view: reuse admin layout with sidebar on the left
  if (isAdmin) {
    return (
      <>
        <AskVoxStarBackground />
        <div className="admin-wrap admin-layout">
          <aside className="admin-sidebar">
            <AdminNavRail onNavigate={(path) => navigate(path)} />
          </aside>
          <main>
            <button
              className="logout-btn admin-settings-logout"
              onClick={handleLogout}
              type="button"
            >
              Logout
            </button>
            <AccountDetails session={session} />
          </main>
        </div>
      </>
    );
  }

  // Regular user view: just show the account card over the star background
  return (
    <>
      <AskVoxStarBackground />
      <AccountDetails session={session} />
    </>
  );
}

import askvoxLogo from "../../components/TopBars/AskVox.png";
import chatIcon from "../../components/Sidebar/chat.png";
import { Settings } from "lucide-react";

interface Props { onNavigate: (path: string) => void }

export default function AdminSidebar({ onNavigate }: Props) {
  return (
    <div className="admin-rail">
      <button className="admin-rail__logoBtn" onClick={() => onNavigate("/admin")}>
        <img className="admin-rail__logo" src={askvoxLogo} alt="AskVox" />
      </button>

      <button className="admin-rail__item" style={{ top: 180 }} onClick={() => onNavigate("/admin") }>
        <span className="admin-rail__icon" style={{ backgroundImage: `url(${askvoxLogo})` }} />
        <span className="admin-rail__label">Dashboard</span>
      </button>

      <button className="admin-rail__item" style={{ top: 280 }} onClick={() => onNavigate("/admin") }>
        <span className="admin-rail__icon" style={{ backgroundImage: `url(${chatIcon})` }} />
        <span className="admin-rail__label">Flagged Response</span>
      </button>

      <button className="admin-rail__item" style={{ top: 380 }} onClick={() => onNavigate("/admin/education") }>
        <span className="admin-rail__icon" style={{ background: "#e5b312" }} />
        <span className="admin-rail__label">Reviewed</span>
      </button>

      <button className="admin-rail__settings" onClick={() => onNavigate("/settings/account")}>
        <span className="admin-rail__settingsIcon">
          <Settings size={20} />
        </span>
      </button>
    </div>
  );
}

import { Link } from "react-router-dom";
import Background from "../../components/background/background";
import { CheckCircle2, X } from "lucide-react";
import "./cssfiles/Confirmed.css";

export default function ConfirmedPage() {
  return (
    <div className="confirm-root">
      <Background />
      <div className="confirm-center">
        <div className="confirm-card">
          <button
            className="confirm-close"
            type="button"
            aria-label="Close"
            onClick={() => { window.location.href = "/"; }}
          >
            <X size={20} />
          </button>
          <div className="confirm-iconWrap">
            <CheckCircle2 className="confirm-icon" size={72} />
          </div>
          <div className="confirm-title">Registration successful 🎉</div>
          <div className="confirm-sub">Your email has been confirmed.</div>
          <Link to="/login" className="confirm-btn">Continue to login</Link>
        </div>
      </div>
    </div>
  );
}
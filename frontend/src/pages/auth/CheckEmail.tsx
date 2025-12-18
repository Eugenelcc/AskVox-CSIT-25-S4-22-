import Background from "../../components/background/background";
import { MailCheck, X } from "lucide-react";
import "./cssfiles/Confirmed.css";

export default function CheckEmailPage() {
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
            <MailCheck className="confirm-icon" size={64} />
          </div>
          <div className="confirm-title">Registration successful</div>
          <div className="confirm-sub">Please check your email to confirm your account.</div>
        </div>
      </div>
    </div>
  );
}
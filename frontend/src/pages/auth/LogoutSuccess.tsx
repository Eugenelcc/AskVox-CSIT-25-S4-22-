import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

export default function LogoutSuccess() {
  const navigate = useNavigate();

  useEffect(() => {
    const id = window.setTimeout(() => navigate("/", { replace: true }), 5000);
    return () => window.clearTimeout(id);
  }, [navigate]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#000",
      color: "#fff",
      position: "relative"
    }}>
      <div style={{
        background: "#0f0f0f",
        border: "1px solid rgba(255,149,28,0.35)",
        borderRadius: 32,
        padding: "56px 64px",
        textAlign: "center",
        boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
        maxWidth: 640,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
          <CheckCircle2 size={96} color="#FF951C" />
        </div>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: 0.2 }}>Logout successfully</div>
        <div style={{ marginTop: 12, opacity: 0.85, fontSize: 16 }}>Redirecting to home…</div>
      </div>
    </div>
  );
}

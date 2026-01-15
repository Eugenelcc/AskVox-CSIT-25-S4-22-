import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import AskVoxStarBackground from "../../components/background/background";
import AdminNavRail from "../../components/Sidebar/AdminNavRail";
import "../admin/AdminDashboard.css";

type FlagRow = {
  id: string;
  created_at?: string | null;
  reason?: string | null;
  category?: string | null;
  type?: string | null;
};

export default function PlatformAdminDashboard() {
  const navigate = useNavigate();
  const [paidCount, setPaidCount] = useState<number>(0);
  const [registeredCount, setRegisteredCount] = useState<number>(0);
  const [flaggedCount, setFlaggedCount] = useState<number>(0);
  const [weekly, setWeekly] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [flagDist, setFlagDist] = useState<{ mis: number; harm: number; out: number }>({ mis: 0, harm: 0, out: 0 });

  const handleLogout = () => {
    // Reuse existing logout flow (LogoutSuccess will clear auth)
    navigate("/logout-success");
  };

  // --- Load dashboard metrics (paid/registered/flagged, weekly, flag distribution) ---
  useEffect(() => {
    let mounted = true;

    const loadCounts = async () => {
      try {
        const s = await supabase
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true);
        const p = await supabase.from("profiles").select("id", { count: "exact", head: true });
        const f = await supabase.from("flagged_responses").select("id", { count: "exact", head: true });
        if (!mounted) return;
        setPaidCount(s.count || 0);
        setRegisteredCount(p.count || 0);
        setFlaggedCount(f.count || 0);
      } catch {
        if (!mounted) return;
        setPaidCount((c) => c);
      }
    };

    const loadWeekly = async () => {
      try {
        const since = new Date();
        since.setDate(since.getDate() - 7);
        const { data } = await supabase
          .from("users")
          .select("created_at")
          .gte("created_at", since.toISOString());
        const bins = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
        (data || []).forEach((row: any) => {
          const d = row?.created_at ? new Date(row.created_at) : null;
          if (!d) return;
          const jsDay = d.getDay();
          const idx = jsDay === 0 ? 6 : jsDay - 1;
          bins[idx] += 1;
        });
        setWeekly(bins);
      } catch {
        setWeekly([400, 300, 400, 550, 420, 480, 300]);
      }
    };

    const loadFlagDist = async () => {
      try {
        const { data } = await supabase
          .from("flagged_responses")
          .select("id,reason,category,type,created_at")
          .limit(500);
        let mis = 0,
          harm = 0,
          out = 0;
        ((data as any as FlagRow[]) || []).forEach((r) => {
          const v = (r.reason || r.category || r.type || "").toString().toLowerCase();
          if (v.includes("mis")) mis++;
          else if (v.includes("harm")) harm++;
          else if (v.includes("out")) out++;
        });
        setFlagDist({ mis, harm, out });
      } catch {
        setFlagDist({ mis: 5, harm: 10, out: 5 });
      }
    };

    loadCounts();
    loadWeekly();
    loadFlagDist();
    const t = setInterval(() => {
      loadCounts();
      loadFlagDist();
    }, 15000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  const donutStyle = useMemo(() => {
    const total = Math.max(flagDist.mis + flagDist.harm + flagDist.out, 1);
    const a = Math.round((flagDist.mis / total) * 360);
    const b = Math.round((flagDist.harm / total) * 360);
    const c = 360 - a - b;
    return {
      background: `conic-gradient(#ff951c 0 ${a}deg, #6a2da8 ${a}deg ${a + b}deg, #e5b312 ${a + b}deg 360deg)`,
    };
  }, [flagDist]);

  return (
    <>
      <AskVoxStarBackground />
      <div className="admin-wrap admin-layout">
        <aside className="admin-sidebar">
          <AdminNavRail onNavigate={(path) => navigate(path)} />
        </aside>
        <main>
          <div className="admin-top">
            <h1 className="admin-title">Hey Platform Admin</h1>
            <button className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>

          <div className="admin-cards">
            <div className="metric-card">
              <div className="metric-title">No of Paid Users</div>
              <div className="metric-value">{paidCount}</div>
            </div>
            <div className="metric-card">
              <div className="metric-title">No of Registered User</div>
              <div className="metric-value">{registeredCount}</div>
            </div>
            <div className="metric-card">
              <div className="metric-title">No of Flagged Requests</div>
              <div className="metric-value">{flaggedCount}</div>
            </div>
          </div>

          <div className="admin-lower">
            <div className="chart-card">
              <div className="metric-title">Registered User for the Week</div>
              <div className="bars">
                {weekly.map((h, i) => (
                  <div
                    key={i}
                    className="bar"
                    style={{ height: `${(Math.min(Math.max(h, 0), 600) / 600) * 300 + 40}px` }}
                  />
                ))}
              </div>
              <div className="week">
                {["Mon", "Tues", "Wed", "Thur", "Fri", "Sat", "Sun"].map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
            </div>

            <div className="chart-card">
              <div className="metric-title">Flagged Type</div>
              <div className="donut-wrap">
                <div className="donut" style={donutStyle}>
                  <div className="donut-hole" />
                </div>
              </div>
              <div className="legend">
                <div>
                  <span className="legend-dot legend-mis" /> Misinformation
                </div>
                <div>
                  <span className="legend-dot legend-harm" /> Harmful Info
                </div>
                <div>
                  <span className="legend-dot legend-out" /> Outdated Info
                </div>
              </div>
            </div>
          </div>

          <div className="admin-footer">
            <button
              className="review-btn"
              type="button"
              onClick={() => navigate("/platformadmin/education")}
            >
              Educational Verification Requests →
            </button>
          </div>
        </main>
      </div>
    </>
  );
}

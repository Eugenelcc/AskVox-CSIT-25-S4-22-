import  { useEffect, useMemo, useState } from "react";
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

type TrendDir = "up" | "down" | "flat";
type Trend = { dir: TrendDir; text: string };

function startOfWeekMonday(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(d: Date, days: number) {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date;
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function trendFromPct(pct: number | null, compareLabel: string): Trend {
  if (pct === null) return { dir: "flat", text: `— vs ${compareLabel}` };
  const abs = Math.abs(pct);
  const rounded = abs >= 10 ? Math.round(abs) : Math.round(abs * 10) / 10;
  if (pct > 0) return { dir: "up", text: `▲ +${rounded}% vs ${compareLabel}` };
  if (pct < 0) return { dir: "down", text: `▼ −${rounded}% vs ${compareLabel}` };
  return { dir: "flat", text: `0% vs ${compareLabel}` };
}

function trendFromDelta(delta: number, compareLabel: string): Trend {
  if (delta > 0) return { dir: "up", text: `▲ +${delta} vs ${compareLabel}` };
  if (delta < 0) return { dir: "down", text: `▼ −${Math.abs(delta)} vs ${compareLabel}` };
  return { dir: "flat", text: `0 vs ${compareLabel}` };
}

function statusFromTrend(pct: number | null): "healthy" | "watch" | "urgent" {
  if (pct === null) return "watch";
  if (pct >= 0) return "healthy";
  if (pct > -5) return "watch";
  return "urgent";
}

export default function PlatformAdminDashboard() {
  const navigate = useNavigate();
  const [paidCount, setPaidCount] = useState<number>(0);
  const [registeredCount, setRegisteredCount] = useState<number>(0);
  const [flaggedCount, setFlaggedCount] = useState<number>(0);
  const [weekly, setWeekly] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [weeklyPrev, setWeeklyPrev] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [flagDist, setFlagDist] = useState<{ mis: number; harm: number; out: number }>({ mis: 0, harm: 0, out: 0 });

  const [paidTrend, setPaidTrend] = useState<Trend>({ dir: "flat", text: "—" });
  const [registeredTrend, setRegisteredTrend] = useState<Trend>({ dir: "flat", text: "—" });
  const [flaggedTrend, setFlaggedTrend] = useState<Trend>({ dir: "flat", text: "—" });

  const [paidTrendPct, setPaidTrendPct] = useState<number | null>(null);
  const [registeredTrendPct, setRegisteredTrendPct] = useState<number | null>(null);

  const [flaggedPending, setFlaggedPending] = useState<number>(0);
  const [flaggedResolved, setFlaggedResolved] = useState<number>(0);
  const [eduPending, setEduPending] = useState<number>(0);

  const handleLogout = () => {
    // Reuse existing logout flow (LogoutSuccess will clear auth)
    navigate("/logout-success");
  };

  // --- Load dashboard metrics (paid/registered/flagged, weekly, flag distribution) ---
  useEffect(() => {
    let mounted = true;

    const countProfilesBetween = async (role: string, fromIso: string, toIso: string) => {
      // Try created_at first; fallback to updated_at if schema differs.
      const tryCol = async (col: "created_at" | "updated_at") => {
        const res = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", role)
          .gte(col, fromIso)
          .lt(col, toIso);
        if (res.error) throw res.error;
        return res.count || 0;
      };

      try {
        return await tryCol("created_at");
      } catch {
        return await tryCol("updated_at");
      }
    };

    const countFlaggedBetween = async (fromIso: string, toIso: string) => {
      const res = await supabase
        .from("flagged_responses")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fromIso)
        .lt("created_at", toIso);
      if (res.error) throw res.error;
      return res.count || 0;
    };

    const loadCounts = async () => {
      try {
        const s = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "paid_user");
        const p = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "user");
        const f = await supabase.from("flagged_responses").select("id", { count: "exact", head: true });

        const fp = await supabase
          .from("flagged_responses")
          .select("id", { count: "exact", head: true })
          .eq("status", "Pending");
        const fr = await supabase
          .from("flagged_responses")
          .select("id", { count: "exact", head: true })
          .eq("status", "Resolved");

        const ep = await supabase
          .from("education_verification_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending");

        const now = new Date();
        const weekStart = startOfWeekMonday(now);
        const weekEnd = addDays(weekStart, 7);
        const prevWeekStart = addDays(weekStart, -7);
        const prevWeekEnd = weekStart;

        const [paidThisWeek, paidLastWeek, regThisWeek, regLastWeek] = await Promise.all([
          countProfilesBetween("paid_user", weekStart.toISOString(), weekEnd.toISOString()),
          countProfilesBetween("paid_user", prevWeekStart.toISOString(), prevWeekEnd.toISOString()),
          countProfilesBetween("user", weekStart.toISOString(), weekEnd.toISOString()),
          countProfilesBetween("user", prevWeekStart.toISOString(), prevWeekEnd.toISOString()),
        ]);

        const paidPct = pctChange(paidThisWeek, paidLastWeek);
        const regPct = pctChange(regThisWeek, regLastWeek);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const yesterdayStart = addDays(todayStart, -1);
        const [flagToday, flagYesterday] = await Promise.all([
          countFlaggedBetween(todayStart.toISOString(), addDays(todayStart, 1).toISOString()),
          countFlaggedBetween(yesterdayStart.toISOString(), todayStart.toISOString()),
        ]);

        if (!mounted) return;
        setPaidCount(s.count || 0);
        setRegisteredCount(p.count || 0);
        setFlaggedCount(f.count || 0);

        setFlaggedPending(fp.count || 0);
        setFlaggedResolved(fr.count || 0);
        setEduPending(ep.count || 0);

        setPaidTrend(trendFromPct(paidPct, "last week"));
        setRegisteredTrend(trendFromPct(regPct, "last week"));
        setFlaggedTrend(trendFromDelta(flagToday - flagYesterday, "yesterday"));

        setPaidTrendPct(paidPct);
        setRegisteredTrendPct(regPct);
      } catch {
        if (!mounted) return;
        setPaidCount((c) => c);
      }
    };

    const loadWeekly = async () => {
      try {
        const now = new Date();
        const weekStart = startOfWeekMonday(now);
        const weekEnd = addDays(weekStart, 7);
        const prevWeekStart = addDays(weekStart, -7);

        // Fetch only the last 14 days worth of user signups (or updated rows if created_at not present)
        const fetchCol = async (col: "created_at" | "updated_at") => {
          const { data, error } = await supabase
            .from("profiles")
            .select(`${col},role`)
            .eq("role", "user")
            .gte(col, prevWeekStart.toISOString())
            .lt(col, weekEnd.toISOString());
          if (error) throw error;
          return data || [];
        };

        let data: any[] = [];
        try {
          data = await fetchCol("created_at");
        } catch {
          data = await fetchCol("updated_at");
        }

        const curr = [0, 0, 0, 0, 0, 0, 0];
        const prev = [0, 0, 0, 0, 0, 0, 0];
        (data || []).forEach((row: any) => {
          const raw = row?.created_at || row?.updated_at;
          const d = raw ? new Date(raw) : null;
          if (!d) return;
          // only consider within prevWeekStart..weekEnd
          if (d < prevWeekStart || d >= weekEnd) return;
          const idx = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon..Sun
          if (d >= weekStart) curr[idx] += 1;
          else prev[idx] += 1;
        });

        setWeekly(curr);
        setWeeklyPrev(prev);
      } catch (err) {
        console.error("Weekly load error:", err);
        setWeekly([0, 0, 0, 0, 0, 0, 0]);
        setWeeklyPrev([0, 0, 0, 0, 0, 0, 0]);
      }
    };

    const loadFlagDist = async () => {
      try {
        const { data } = await supabase
          .from("flagged_responses")
          .select("reason")
          .limit(500);
        let mis = 0,
          harm = 0,
          out = 0;
        ((data as any as FlagRow[]) || []).forEach((r) => {
          const v = (r.reason || "").toString().toLowerCase();
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
    //const c = 360 - a - b;
    return {
      background: `conic-gradient(#ff951c 0 ${a}deg, #6a2da8 ${a}deg ${a + b}deg, #e5b312 ${a + b}deg 360deg)`,
    };
  }, [flagDist]);

  const usersThisWeekTotal = useMemo(() => weekly.reduce((a, b) => a + b, 0), [weekly]);
  const usersLastWeekTotal = useMemo(() => weeklyPrev.reduce((a, b) => a + b, 0), [weeklyPrev]);
  const usersWeekTrend = useMemo(() => {
    const pct = pctChange(usersThisWeekTotal, usersLastWeekTotal);
    return trendFromPct(pct, "last week");
  }, [usersThisWeekTotal, usersLastWeekTotal]);
  const usersAvg = useMemo(() => (weekly.length ? usersThisWeekTotal / 7 : 0), [usersThisWeekTotal, weekly.length]);

  const usersMaxY = useMemo(() => {
    const maxVal = Math.max(1, ...weekly, ...weeklyPrev);
    // Keep chart readable for small numbers
    return Math.max(maxVal, 10);
  }, [weekly, weeklyPrev]);

  const avgLineBottomPx = useMemo(() => {
    const h = (Math.min(Math.max(usersAvg, 0), usersMaxY) / usersMaxY) * 300 + 40;
    // bars container has 16px padding-bottom in CSS
    return 16 + h;
  }, [usersAvg, usersMaxY]);

  const donutMeta = useMemo(() => {
    const total = Math.max(flagDist.mis + flagDist.harm + flagDist.out, 1);
    const pct = (n: number) => Math.round((n / total) * 100);
    return {
      total,
      misPct: pct(flagDist.mis),
      harmPct: pct(flagDist.harm),
      outPct: pct(flagDist.out),
    };
  }, [flagDist]);

  const paidStatus = useMemo(() => statusFromTrend(paidTrendPct), [paidTrendPct]);
  const registeredStatus = useMemo(() => statusFromTrend(registeredTrendPct), [registeredTrendPct]);
  const flaggedStatus = useMemo<"healthy" | "watch" | "urgent">(() => {
    if (flaggedPending >= 10) return "urgent";
    if (flaggedPending >= 5) return "watch";
    return "healthy";
  }, [flaggedPending]);

  return (
    <>
      <AskVoxStarBackground />
      <div className="admin-wrap admin-layout admin-dashboard--compact">
        <aside className="admin-sidebar">
          <AdminNavRail onNavigate={(path) => navigate(path)} />
        </aside>
        <main>
          <div className="admin-top">
            <h1 className="admin-title">Hey Platform Admin</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="review-btn"
                type="button"
                onClick={() => navigate("/platformadmin/education")}
              >
                Educational Verification Requests →
              </button>
              <button className="logout-btn" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="admin-cards">
            <div className={`metric-card metric-card--${paidStatus}`}>
              <div className="metric-title">No of Paid Users</div>
              <div className="metric-value">{paidCount}</div>
              <div className={`metric-meta trend trend-${paidTrend.dir}`}>{paidTrend.text}</div>
            </div>
            <div className={`metric-card metric-card--${registeredStatus}`}>
              <div className="metric-title">No of Registered User</div>
              <div className="metric-value">{registeredCount}</div>
              <div className={`metric-meta trend trend-${registeredTrend.dir}`}>{registeredTrend.text}</div>
            </div>
            <button
              type="button"
              className={`metric-card metric-card--clickable metric-card--${flaggedStatus}`}
              onClick={() => navigate("/platformadmin/flagged?status=Pending")}
              aria-label="Review flagged requests"
            >
              <div className="metric-title">No of Flagged Requests</div>
              <div className="metric-value">{flaggedCount}</div>
              <div className="metric-subgrid">
                <div className="metric-subline"><span className="metric-subkey">{flaggedPending}</span> pending</div>
                <div className="metric-subline"><span className="metric-subkey">{flaggedResolved}</span> resolved</div>
              </div>
              <div className={`metric-meta trend trend-${flaggedTrend.dir}`}>{flaggedTrend.text}</div>
              <div className="metric-cta">Review Now →</div>
            </button>
          </div>

          <div className="admin-lower">
            <div className="chart-card">
              <div className="metric-title">Registered User for the Week</div>
              <div className="chart-subtitle">
                This week: {usersThisWeekTotal} • Last week: {usersLastWeekTotal} • <span className={`trend trend-${usersWeekTrend.dir}`}>{usersWeekTrend.text}</span>
              </div>
              <div className="bars">
                <div className="avg-line" style={{ bottom: `${avgLineBottomPx}px` }} />
                <div className="avg-label" style={{ bottom: `${avgLineBottomPx + 6}px` }}>Avg {Math.round(usersAvg * 10) / 10}</div>
                {weekly.map((h, i) => {
                  const prev = weeklyPrev[i] || 0;
                  const diff = h - prev;
                  const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
                  const title = `${["Mon","Tues","Wed","Thur","Fri","Sat","Sun"][i]}: ${h} users (${arrow} from last week’s ${prev})`;
                  return (
                    <div key={i} className="bar-container" title={title}>
                      <div className="bar-label">{h}</div>
                      <div
                        className="bar"
                        style={{ height: `${(Math.min(Math.max(h, 0), usersMaxY) / usersMaxY) * 300 + 40}px` }}
                      />
                      <div className="bar-compare">{arrow} {prev}</div>
                    </div>
                  );
                })}
              </div>
              <div className="week">
                {["Mon", "Tues", "Wed", "Thur", "Fri", "Sat", "Sun"].map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
            </div>

            <div className="admin-right-col">
              <div className="chart-card pending-actions">
                <div className="metric-title">Pending Actions</div>
                <div className="pending-list">
                  <button
                    type="button"
                    className="pending-item"
                    onClick={() => navigate("/platformadmin/flagged?status=Pending")}
                  >
                    <span className="pending-dot pending-amber" />
                    <span className="pending-text">{flaggedPending} flagged responses awaiting review</span>
                    <span className="pending-go">→</span>
                  </button>
                  <button
                    type="button"
                    className="pending-item"
                    onClick={() => navigate("/platformadmin/education")}
                  >
                    <span className="pending-dot pending-amber" />
                    <span className="pending-text">{eduPending} educational verification requests</span>
                    <span className="pending-go">→</span>
                  </button>
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
                  <button
                    type="button"
                    className="legend-item"
                    onClick={() => navigate("/platformadmin/flagged?reason=misinfo")}
                  >
                    <span className="legend-dot legend-mis" />
                    <span className="legend-text">Misinformation – {donutMeta.misPct}%</span>
                  </button>
                  <button
                    type="button"
                    className="legend-item"
                    onClick={() => navigate("/platformadmin/flagged?reason=harmful")}
                  >
                    <span className="legend-dot legend-harm" />
                    <span className="legend-text">Harmful Info – {donutMeta.harmPct}%</span>
                  </button>
                  <button
                    type="button"
                    className="legend-item"
                    onClick={() => navigate("/platformadmin/flagged?reason=outdated")}
                  >
                    <span className="legend-dot legend-out" />
                    <span className="legend-text">Outdated Info – {donutMeta.outPct}%</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

        </main>
      </div>
    </>
  );
}

import React from "react";
import { useNavigate } from "react-router-dom";

import Background from "../../components/background/background";
import PlatformAdminNavRail from "./PlatformAdminNavRail";
import StatCard from "./components/StatCard";
import "./dashboard.css";

export default function PlatformAdminDashboard() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    sessionStorage.clear();
    navigate("/login");
  };

  return (
    <div className="pa-dashboard">
      <PlatformAdminNavRail activeTab="" onTabClick={() => {}} />
      <Background />

      <div className="pa-dashboard__canvas">
        {/* Title / Subtitle */}
        <div className="pa-dashboard__title">AskVox</div>
        <div className="pa-dashboard__subtitle">
          Here is today’s Report and performance
        </div>

        {/* Logout */}
        <button type="button" className="pa-dashboard__logout" onClick={handleLogout}>
          Logout
        </button>

        {/* Top Cards */}
        <div className="pa-dashboard__cardsRow">
          <StatCard title="No of Paid Users" value={200} />
          <StatCard title="No of Registered User" value={5000} />
          <StatCard title="No of Flagged Requests" value={20} />
        </div>

        {/* Rectangle 56 */}
        <section className="pa-panel56">
          <div className="pa-panel56__title">Registered User for the Week</div>

          <div className="pa-panel56__frame" />

          <div className="pa-panel56__y y500">500</div>
          <div className="pa-panel56__y y400">400</div>
          <div className="pa-panel56__y y300">300</div>
          <div className="pa-panel56__y y200">200</div>
          <div className="pa-panel56__y y100">100</div>
          <div className="pa-panel56__y y0">0</div>

          <div className="pa-bar b1" />
          <div className="pa-bar b2" />
          <div className="pa-bar b3" />
          <div className="pa-bar b4" />
          <div className="pa-bar b5" />
          <div className="pa-bar b6" />
          <div className="pa-bar b7" />

          <div className="pa-panel56__x mon">Mon</div>
          <div className="pa-panel56__x tues">Tues</div>
          <div className="pa-panel56__x wed">Wed</div>
          <div className="pa-panel56__x thur">Thur</div>
          <div className="pa-panel56__x fri">Fri</div>
          <div className="pa-panel56__x sat">Sat</div>
          <div className="pa-panel56__x sun">Sun</div>
        </section>

        {/* Rectangle 57 */}
        <section className="pa-panel57">
          <div className="pa-panel57__title">Flagged Type</div>

          {/* Donut (예시) */}
          <div
            className="pa-donutEx"
            style={
              {
                "--p1": "55%",
                "--p2": "30%",
                "--p3": "15%",
              } as React.CSSProperties
            }
          >
            <div className="pa-donutEx__hole" />
          </div>

          {/* ✅ Legend: 글씨는 흰색, 스와치만 색 변경 */}
          <div className="pa-legend2">
            <div className="pa-legend2__row pa-legend2__row--single">
              <div className="pa-legend2__item">
                <span className="pa-legend2__swatch is-misinfo" />
                <span>Misinformation</span>
              </div>
            </div>

            <div className="pa-legend2__row pa-legend2__row--double">
              <div className="pa-legend2__item">
                <span className="pa-legend2__swatch is-harmful" />
                <span>Harmful Info</span>
              </div>

              <div className="pa-legend2__item pa-legend2__item--right">
                <span className="pa-legend2__swatch is-outdated" />
                <span>Outdated Info</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

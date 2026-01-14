import React from 'react';
import './DiscoverNews.css';

export interface WeeklyForecastItem {
	day: string;
	temp: number;
	icon?: 'cloudy' | 'sunny' | 'rainy' | 'thunder';
}

export interface WeatherSummary {
	location: string;
	temp: number;
	condition: string;
	high: number;
	low: number;
	weekly?: WeeklyForecastItem[];
}

export interface Standing {
	position: number;
	club: string;
	badgeUrl: string;
	points: number;
}

export interface MatchItem {
	home: string;
	homeBadgeUrl: string;
	away: string;
	awayBadgeUrl: string;
	dateLabel: string; // e.g., "Tomorrow" or "Thu, 4 Dec"
	timeLabel?: string; // e.g., "3:30 am"
}

export interface RightWidgetPanelProps {
	weather: WeatherSummary;
	standings: Standing[];
	upcoming: MatchItem[];
	leagueTitle?: string;
	seasonLabel?: string;
}

const RightWidgetPanel: React.FC<RightWidgetPanelProps> = ({
	weather,
	standings,
	upcoming,
	leagueTitle = 'Premier League',
	seasonLabel = 'Season 2022 - 2023',
}) => {
	return (
		<div className="right-panel">
			{/* Weather */}
			<div className="weather-card">
				<div className="weather-card__top">
					<div>
						<div style={{ fontSize: 24, color: 'rgba(255,255,255,0.54)' }}>{weather.temp}°</div>
						<div style={{ fontSize: 16, color: 'rgba(255,255,255,0.54)' }}>{weather.condition}</div>
					</div>
					<div style={{ textAlign: 'right' }}>
						<div style={{ fontSize: 16, color: 'rgba(255,255,255,0.54)' }}>{weather.location}</div>
						<div style={{ fontSize: 13, color: 'rgba(78,78,78,0.54)' }}>H:{weather.high}° L:{weather.low}°</div>
					</div>
				</div>
				{weather.weekly && (
					<div className="weather-card__weekly">
						{weather.weekly.map((w, idx) => (
							<div className="weekly-item" key={idx}>
								<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 14 }}>{w.temp}°</div>
								<div style={{ color: '#626262', fontSize: 14 }}>{w.day}</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* League */}
			<div>
				<div className="league-header">
					<img src="/assets/premier-league.png" alt="league" style={{ width: 46, height: 48, borderRadius: 154 }} />
					<div>
						<div className="league-title">{leagueTitle}</div>
						<div className="league-season">{seasonLabel}</div>
					</div>
				</div>
				<div className="league-table">
					{/* Header row */}
					<div className="league-row" style={{ color: '#FFFFFF' }}>
						<div style={{ width: 25, textAlign: 'center' }}>#</div>
						<div style={{ flex: 1 }}>Club</div>
						<div style={{ width: 26, textAlign: 'center' }}>Pts</div>
					</div>
					{standings.map((s) => (
						<div className="league-row" key={s.position}>
							<div className="league-pos">{s.position}</div>
							<div className="league-club">
								<img src={s.badgeUrl} alt={s.club} style={{ width: 32, height: 32, borderRadius: 4 }} />
								<span>{s.club}</span>
							</div>
							<div className="league-points">{s.points}</div>
						</div>
					))}
				</div>
			</div>

			{/* Upcoming Matches */}
			<div className="matches-section">
				<div className="matches-header">Upcoming Matches</div>
				{upcoming.map((m, idx) => (
					<div className="match-row" key={idx}>
						<div className="match-team">
							<img src={m.homeBadgeUrl} alt={m.home} style={{ width: 32, height: 32, borderRadius: 4 }} />
							<span>{m.home}</span>
						</div>
						<div className="match-team">
							<img src={m.awayBadgeUrl} alt={m.away} style={{ width: 32, height: 32, borderRadius: 4 }} />
							<span>{m.away}</span>
						</div>
						<div className="match-time">
							<div>{m.dateLabel}</div>
							{m.timeLabel && <div style={{ color: '#919191', fontSize: 11 }}>{m.timeLabel}</div>}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

export default RightWidgetPanel;

 
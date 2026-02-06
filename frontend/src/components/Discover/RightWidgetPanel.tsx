import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cloud, CloudFog, CloudLightning, CloudRain, RefreshCw, Snowflake, Sun } from 'lucide-react';
import './DiscoverNews.css';

import type { WeatherIcon } from '../../services/weatherApi';
import { fetchSportsScoreboard, type SportKey, type SportsEvent } from '../../services/sportsApi';

export interface WeeklyForecastItem {
	day: string;
	temp: number;
	icon?: WeatherIcon;
}

export interface WeatherSummary {
	location: string;
	temp: number;
	condition: string;
	icon?: WeatherIcon;
	high: number;
	low: number;
	weekly?: WeeklyForecastItem[];
}

function WeatherGlyph({ icon, size = 22 }: { icon?: WeatherIcon; size?: number }) {
	const common = { size, color: 'rgba(255,255,255,0.66)' } as const;
	switch (icon) {
		case 'sunny':
			return <Sun {...common} />;
		case 'rainy':
			return <CloudRain {...common} />;
		case 'thunder':
			return <CloudLightning {...common} />;
		case 'fog':
			return <CloudFog {...common} />;
		case 'snow':
			return <Snowflake {...common} />;
		case 'cloudy':
		default:
			return <Cloud {...common} />;
	}
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
}

const RightWidgetPanel: React.FC<RightWidgetPanelProps> = ({
	weather,
}) => {
	const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n)) : '–');

	const sportsOrder: SportKey[] = useMemo(() => ['soccer', 'nba', 'nfl', 'mlb'], []);
	const sportLabels: Record<SportKey, string> = useMemo(
		() => ({ soccer: 'Soccer', nba: 'NBA', nfl: 'NFL', mlb: 'Baseball' }),
		[]
	);

	type LeagueOption = { code: string; label: string };

	const leagueOptionsBySport: Record<SportKey, LeagueOption[]> = useMemo(
		() => ({
			soccer: [
				{ code: 'eng.1', label: 'EPL' },
				{ code: 'esp.1', label: 'LaLiga' },
				{ code: 'ita.1', label: 'Serie A' },
				{ code: 'ger.1', label: 'Bundesliga' },
				{ code: 'fra.1', label: 'Ligue 1' },
				{ code: 'uefa.champions', label: 'UCL' },
			],
			nba: [
				{ code: 'nba', label: 'NBA' },
				{ code: 'wnba', label: 'WNBA' },
			],
			nfl: [{ code: 'nfl', label: 'NFL' }],
			mlb: [{ code: 'mlb', label: 'MLB' }],
		}),
		[]
	);

	const [selectedSport, setSelectedSport] = useState<SportKey>('soccer');
	const [selectedLeague, setSelectedLeague] = useState<string>(() => leagueOptionsBySport.soccer[0]?.code || 'eng.1');
	const [sportsLoading, setSportsLoading] = useState<boolean>(true);
	const [sportsError, setSportsError] = useState<string | null>(null);
	const [liveEvents, setLiveEvents] = useState<SportsEvent[]>([]);
	const [upcomingEvents, setUpcomingEvents] = useState<SportsEvent[]>([]);
	const [recentEvents, setRecentEvents] = useState<SportsEvent[]>([]);
	const [showRecent, setShowRecent] = useState<boolean>(false);
	const [lastUpdated, setLastUpdated] = useState<string | null>(null);
	const [sportsRefreshTick, setSportsRefreshTick] = useState<number>(0);

	const formatKickoff = (iso: string | null | undefined): { dateLabel: string; timeLabel?: string } => {
		if (!iso) return { dateLabel: '—' };
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return { dateLabel: '—' };

		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const startOfThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const dayDiff = Math.round((startOfThatDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));

		let dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
		if (dayDiff === 0) dateLabel = 'Today';
		if (dayDiff === 1) dateLabel = 'Tomorrow';

		const timeLabel = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		return { dateLabel, timeLabel };
	};

	const getTeamName = (t?: { shortName?: string | null; name?: string | null } | null) =>
		t?.shortName || t?.name || 'TBD';

	const getLogo = (t?: { logo?: string | null } | null) => t?.logo || '/assets/club/placeholder.png';

	const renderSkeletonRows = (count: number) => {
		return Array.from({ length: count }).map((_, idx) => (
			<div className="match-row match-row--skeleton" key={`sk-${idx}`}>
				<div className="match-team">
					<div className="skeleton skeleton--logo" />
					<div className="skeleton skeleton--text" style={{ width: 92 }} />
				</div>
				<div className="match-team">
					<div className="skeleton skeleton--logo" />
					<div className="skeleton skeleton--text" style={{ width: 92 }} />
				</div>
				<div className="match-time">
					<div className="skeleton skeleton--text" style={{ width: 72, marginLeft: 'auto' }} />
					<div className="skeleton skeleton--text" style={{ width: 56, marginLeft: 'auto', marginTop: 6, opacity: 0.75 }} />
				</div>
			</div>
		));
	};

	const isAbortError = (err: unknown) => {
		const anyErr = err as any;
		return anyErr?.name === 'AbortError' || (typeof anyErr?.message === 'string' && anyErr.message.toLowerCase().includes('aborted'));
	};

	const loadSports = async (sport: SportKey, league: string, signal: AbortSignal) => {
		setSportsError(null);
		setSportsLoading(true);
		try {
			const data = await fetchSportsScoreboard({ sport, league, signal });
			setLiveEvents(Array.isArray(data.live) ? data.live.slice(0, 6) : []);
			setUpcomingEvents(Array.isArray(data.upcoming) ? data.upcoming.slice(0, 6) : []);
			setRecentEvents(Array.isArray(data.recent) ? data.recent.slice(0, 6) : []);
			setLastUpdated(typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString());
		} catch (e: any) {
			// Abort happens on fast switching; don't show it as an error.
			if (isAbortError(e)) return;
			setSportsError(typeof e?.message === 'string' ? e.message : 'Failed to load sports');
			setLiveEvents([]);
			setUpcomingEvents([]);
			setRecentEvents([]);
		} finally {
			// If aborted, we keep loading until the next request resolves.
			setSportsLoading(false);
		}
	};

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();

		const run = async () => {
			await loadSports(selectedSport, selectedLeague, controller.signal);
			if (cancelled) return;
			// Poll for live updates.
			const interval = window.setInterval(() => {
				loadSports(selectedSport, selectedLeague, controller.signal).catch(() => {
					// ignore (we surface errors on the next user interaction)
				});
			}, 30_000);
			// Cleanup interval
			(controller.signal as any).__sportsInterval = interval;
		};

		run();
		return () => {
			cancelled = true;
			try {
				const interval = (controller.signal as any).__sportsInterval;
				if (interval) window.clearInterval(interval);
			} catch {
				// ignore
			}
			controller.abort();
		};
	}, [selectedSport, selectedLeague, sportsRefreshTick]);

	const leagueLabel = useMemo(() => {
		const opts = leagueOptionsBySport[selectedSport] || [];
		return opts.find((o) => o.code === selectedLeague)?.label || selectedLeague;
	}, [leagueOptionsBySport, selectedLeague, selectedSport]);

	const selectSport = (sport: SportKey) => {
		setSelectedSport(sport);
		setShowRecent(false);
		setSelectedLeague((prev) => {
			const opts = leagueOptionsBySport[sport] || [];
			if (opts.some((o) => o.code === prev)) return prev;
			return opts[0]?.code || prev;
		});
	};

	const refreshNow = () => {
		setSportsRefreshTick((t) => t + 1);
	};

	const setSportByIndex = (idx: number) => {
		const normalized = ((idx % sportsOrder.length) + sportsOrder.length) % sportsOrder.length;
		setSelectedSport(sportsOrder[normalized]);
	};

	const goPrevSport = () => {
		const currentIdx = sportsOrder.indexOf(selectedSport);
		setSportByIndex(currentIdx - 1);
	};

	const goNextSport = () => {
		const currentIdx = sportsOrder.indexOf(selectedSport);
		setSportByIndex(currentIdx + 1);
	};

	return (
		<div className="right-panel">
			{/* Weather */}
			<div className="weather-card">
				<div className="weather-card__top">
					<div>
						<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
							<WeatherGlyph icon={weather.icon} size={24} />
							<div style={{ fontSize: 24, color: 'rgba(255,255,255,0.54)' }}>{fmt(weather.temp)}°</div>
						</div>
						<div style={{ fontSize: 16, color: 'rgba(255,255,255,0.54)' }}>{weather.condition}</div>
					</div>
					<div style={{ textAlign: 'right' }}>
						<div style={{ fontSize: 16, color: 'rgba(255,255,255,0.54)' }}>{weather.location}</div>
						<div style={{ fontSize: 13, color: 'rgba(78,78,78,0.54)' }}>H:{fmt(weather.high)}° L:{fmt(weather.low)}°</div>
					</div>
				</div>
				{weather.weekly && (
					<div className="weather-card__weekly">
						{weather.weekly.map((w, idx) => (
							<div className="weekly-item" key={idx}>
								<div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>
									<WeatherGlyph icon={w.icon} size={18} />
								</div>
								<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 14 }}>{fmt(w.temp)}°</div>
								<div style={{ color: '#626262', fontSize: 14 }}>{w.day}</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Sports (Live + Upcoming) */}
			<div className="sports-card">
				<div className="sports-header">
					<div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Live Sports</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<button
							type="button"
							className={sportsLoading ? 'sports-nav sports-nav--loading' : 'sports-nav'}
							onClick={refreshNow}
							disabled={sportsLoading}
							aria-label="Refresh sports"
							title="Refresh"
						>
							<RefreshCw size={16} className={sportsLoading ? 'spin' : undefined} />
						</button>
						<button
							type="button"
							className="sports-nav"
							onClick={goPrevSport}
							aria-label="Previous sport"
							title="Previous"
						>
							<ChevronLeft size={18} />
						</button>
						<button
							type="button"
							className="sports-nav"
							onClick={goNextSport}
							aria-label="Next sport"
							title="Next"
						>
							<ChevronRight size={18} />
						</button>
					</div>
				</div>

				<div className="sports-tabs" role="tablist" aria-label="Sports selector">
					{sportsOrder.map((k) => (
						<button
							key={k}
							type="button"
							className={k === selectedSport ? 'sports-tab sports-tab--active' : 'sports-tab'}
							onClick={() => selectSport(k)}
						>
							{sportLabels[k]}
						</button>
					))}
				</div>

				<div className="league-tabs" role="tablist" aria-label="League selector">
					{leagueOptionsBySport[selectedSport].map((opt) => (
						<button
							key={opt.code}
							type="button"
							className={opt.code === selectedLeague ? 'league-tab league-tab--active' : 'league-tab'}
							onClick={() => setSelectedLeague(opt.code)}
						>
							{opt.label}
						</button>
					))}
				</div>
				<div className="sports-subhead">
					<div>League: <span style={{ color: '#FFFFFF' }}>{leagueLabel}</span></div>
					{lastUpdated ? (
						<div>Updated: {new Date(lastUpdated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
					) : null}
				</div>

				{sportsError ? (
					<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 4px 0 4px' }}>
						{sportsError}
					</div>
				) : null}

				<div className="matches-section" style={{ marginTop: 12 }}>
					<div className="matches-header">Live Now ({sportLabels[selectedSport]})</div>
					{sportsLoading ? (
						renderSkeletonRows(3)
					) : liveEvents.length === 0 ? (
						<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>No live matches right now</div>
					) : (
						liveEvents.map((ev, idx) => {
							const home = ev.home || null;
							const away = ev.away || null;
							return (
								<div className="match-row" key={ev.id || idx}>
									<div className="match-team">
										<img src={getLogo(home)} alt={getTeamName(home)} style={{ width: 26, height: 26, borderRadius: 4 }} />
										<span>{getTeamName(home)}</span>
									</div>
									<div className="match-team">
										<img src={getLogo(away)} alt={getTeamName(away)} style={{ width: 26, height: 26, borderRadius: 4 }} />
										<span>{getTeamName(away)}</span>
									</div>
									<div className="match-time">
										<div style={{ fontWeight: 700 }}>{home?.score ?? '–'} - {away?.score ?? '–'}</div>
										<div style={{ color: '#FF951C', fontSize: 11 }}>{ev.status?.shortDetail || ev.status?.detail || 'Live'}</div>
									</div>
								</div>
							);
						})
					)}
				</div>

				<div className="matches-section" style={{ marginTop: 12 }}>
					<div className="matches-header">Upcoming</div>
					{sportsLoading ? (
						renderSkeletonRows(3)
					) : upcomingEvents.length === 0 ? (
						<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>No upcoming matches found</div>
					) : (
						upcomingEvents.map((ev, idx) => {
							const home = ev.home || null;
							const away = ev.away || null;
							const { dateLabel, timeLabel } = formatKickoff(ev.date);
							return (
								<div className="match-row" key={ev.id || `up-${idx}`}>
									<div className="match-team">
										<img src={getLogo(home)} alt={getTeamName(home)} style={{ width: 26, height: 26, borderRadius: 4 }} />
										<span>{getTeamName(home)}</span>
									</div>
									<div className="match-team">
										<img src={getLogo(away)} alt={getTeamName(away)} style={{ width: 26, height: 26, borderRadius: 4 }} />
										<span>{getTeamName(away)}</span>
									</div>
									<div className="match-time">
										<div>{dateLabel}</div>
										{timeLabel ? <div style={{ color: '#919191', fontSize: 11 }}>{timeLabel}</div> : null}
									</div>
								</div>
							);
						})
					)}
				</div>

				<div className="matches-section" style={{ marginTop: 12 }}>
					<div className="matches-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<span>Recent (Final)</span>
						{recentEvents.length > 0 ? (
							<button
								type="button"
								className="section-toggle"
								onClick={() => setShowRecent((s) => !s)}
								aria-expanded={showRecent}
							>
								{showRecent ? (
									<>
										Hide <ChevronUp size={14} />
									</>
								) : (
									<>
										Show <ChevronDown size={14} />
									</>
								)}
							</button>
						) : null}
					</div>
					{sportsLoading ? (
						renderSkeletonRows(2)
					) : recentEvents.length === 0 ? (
						<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>
							No recent finished matches found
						</div>
					) : showRecent ? (
						recentEvents.map((ev, idx) => {
							const home = ev.home || null;
							const away = ev.away || null;
							const { dateLabel } = formatKickoff(ev.date);
							return (
								<div className="match-row" key={ev.id || `rec-${idx}`}>
									<div className="match-team">
										<img src={getLogo(home)} alt={getTeamName(home)} style={{ width: 26, height: 26, borderRadius: 4 }} />
										<span>{getTeamName(home)}</span>
									</div>
									<div className="match-team">
										<img src={getLogo(away)} alt={getTeamName(away)} style={{ width: 26, height: 26, borderRadius: 4 }} />
										<span>{getTeamName(away)}</span>
									</div>
									<div className="match-time">
										<div style={{ fontWeight: 700 }}>{home?.score ?? '–'} - {away?.score ?? '–'}</div>
										<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 11 }}>{ev.status?.shortDetail || ev.status?.detail || dateLabel}</div>
									</div>
								</div>
							);
						})
					) : (
						<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>
							Click “Show” to view finished games
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default RightWidgetPanel;

 
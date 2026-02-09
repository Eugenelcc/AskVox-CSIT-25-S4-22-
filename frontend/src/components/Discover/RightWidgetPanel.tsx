import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cloud, CloudFog, CloudLightning, CloudRain, RefreshCw, Snowflake, Sun } from 'lucide-react';
import './DiscoverNews.css';

import type { WeatherIcon } from '../../services/weatherApi';
import { fetchSportsScoreboard, fetchSportsStandings, type SportKey, type SportsEvent, type SportsStandingsResponse, type StandingsSportKey, type StandingsEntry } from '../../services/sportsApi';

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

	const standingsOrder: StandingsSportKey[] = useMemo(() => ['soccer', 'nba', 'nfl', 'mlb'], []);
	const standingsLabels: Record<StandingsSportKey, string> = useMemo(
		() => ({ soccer: 'Soccer', nba: 'NBA', nfl: 'NFL', mlb: 'Baseball' }),
		[]
	);
	const [selectedStandingsSport, setSelectedStandingsSport] = useState<StandingsSportKey>('soccer');
	const [selectedStandingsLeague, setSelectedStandingsLeague] = useState<string>(() => leagueOptionsBySport.soccer[0]?.code || 'eng.1');
	const [standingsLoading, setStandingsLoading] = useState<boolean>(true);
	const [standingsError, setStandingsError] = useState<string | null>(null);
	const [standingsData, setStandingsData] = useState<SportsStandingsResponse | null>(null);
	const [showStandings, setShowStandings] = useState<boolean>(true);
	const [standingsRefreshTick, setStandingsRefreshTick] = useState<number>(0);

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

	const getLogo = (t?: { logo?: string | null } | null) => t?.logo || '/assets/club/placeholder.svg';

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

	const getErrorMessage = useCallback((err: unknown): string => {
		if (err instanceof Error && typeof err.message === 'string') return err.message;
		if (typeof err === 'string') return err;
		if (err && typeof err === 'object') {
			const rec = err as Record<string, unknown>;
			const msg = rec.message;
			if (typeof msg === 'string') return msg;
		}
		return 'Unknown error';
	}, []);

	const isAbortError = useCallback((err: unknown): boolean => {
		if (err instanceof DOMException && err.name === 'AbortError') return true;
		if (err && typeof err === 'object') {
			const rec = err as Record<string, unknown>;
			if (rec.name === 'AbortError') return true;
		}
		return getErrorMessage(err).toLowerCase().includes('aborted');
	}, [getErrorMessage]);

	const loadSports = useCallback(async (sport: SportKey, league: string, signal: AbortSignal) => {
		setSportsError(null);
		setSportsLoading(true);
		try {
			const data = await fetchSportsScoreboard({ sport, league, signal });
			setLiveEvents(Array.isArray(data.live) ? data.live.slice(0, 6) : []);
			setUpcomingEvents(Array.isArray(data.upcoming) ? data.upcoming.slice(0, 6) : []);
			setRecentEvents(Array.isArray(data.recent) ? data.recent.slice(0, 6) : []);
			setLastUpdated(typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString());
		} catch (err: unknown) {
			// Abort happens on fast switching; don't show it as an error.
			if (isAbortError(err)) return;
			setSportsError(getErrorMessage(err));
			setLiveEvents([]);
			setUpcomingEvents([]);
			setRecentEvents([]);
		} finally {
			// If aborted, we keep loading until the next request resolves.
			setSportsLoading(false);
		}
	}, [getErrorMessage, isAbortError]);

	const loadStandings = useCallback(async (sport: StandingsSportKey, league: string, signal: AbortSignal) => {
		setStandingsError(null);
		setStandingsLoading(true);
		try {
			const data = await fetchSportsStandings({ sport, league, signal });
			setStandingsData(data);
		} catch (err: unknown) {
			if (isAbortError(err)) return;
			setStandingsError(getErrorMessage(err));
			setStandingsData(null);
		} finally {
			setStandingsLoading(false);
		}
	}, [getErrorMessage, isAbortError]);

	const sportsIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		loadSports(selectedSport, selectedLeague, controller.signal).catch(() => {
			// handled inside loadSports
		});

		if (sportsIntervalRef.current) {
			window.clearInterval(sportsIntervalRef.current);
			sportsIntervalRef.current = null;
		}
		// Poll for live updates.
		sportsIntervalRef.current = window.setInterval(() => {
			loadSports(selectedSport, selectedLeague, controller.signal).catch(() => {
				// ignore (we surface errors on the next user interaction)
			});
		}, 30_000);

		return () => {
			if (sportsIntervalRef.current) {
				window.clearInterval(sportsIntervalRef.current);
				sportsIntervalRef.current = null;
			}
			controller.abort();
		};
	}, [loadSports, selectedLeague, selectedSport, sportsRefreshTick]);

	useEffect(() => {
		const controller = new AbortController();

		loadStandings(selectedStandingsSport, selectedStandingsLeague, controller.signal).catch(() => {
			// handled in loadStandings
		});

		return () => {
			controller.abort();
		};
	}, [loadStandings, selectedStandingsLeague, selectedStandingsSport, standingsRefreshTick]);

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

	const refreshStandingsNow = () => {
		setStandingsRefreshTick((t) => t + 1);
	};

	const selectStandingsSport = (sport: StandingsSportKey) => {
		setSelectedStandingsSport(sport);
		setSelectedStandingsLeague((prev) => {
			const opts = leagueOptionsBySport[sport as unknown as SportKey] || [];
			if (opts.some((o) => o.code === prev)) return prev;
			return opts[0]?.code || prev;
		});
	};

	const getStatDisplay = (entry: StandingsEntry, keys: string[]): string | null => {
		for (const key of keys) {
			const d = entry.stats?.[key]?.display;
			if (typeof d === 'string' && d.trim() !== '') return d;
			const v = entry.stats?.[key]?.value;
			if (typeof v === 'string' && v.trim() !== '') return v;
			if (typeof v === 'number' && Number.isFinite(v)) return String(v);
		}
		return null;
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

			{/* Standings */}
			<div className="standings-card">
				<div className="sports-header">
					<div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Standings</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<button
							type="button"
							className={standingsLoading ? 'sports-nav sports-nav--loading' : 'sports-nav'}
							onClick={refreshStandingsNow}
							disabled={standingsLoading}
							aria-label="Refresh standings"
							title="Refresh"
						>
							<RefreshCw size={16} className={standingsLoading ? 'spin' : undefined} />
						</button>
						<button
							type="button"
							className="sports-nav"
							onClick={() => setShowStandings((s) => !s)}
							aria-expanded={showStandings}
							title={showStandings ? 'Hide standings' : 'Show standings'}
						>
							{showStandings ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
						</button>
					</div>
				</div>

				<div className="sports-tabs" role="tablist" aria-label="Standings sport selector">
					{standingsOrder.map((k) => (
						<button
							key={k}
							type="button"
							className={k === selectedStandingsSport ? 'sports-tab sports-tab--active' : 'sports-tab'}
							onClick={() => selectStandingsSport(k)}
						>
							{standingsLabels[k]}
						</button>
					))}
				</div>

				<div className="league-tabs" role="tablist" aria-label="Standings league selector">
					{(leagueOptionsBySport[selectedStandingsSport as unknown as SportKey] || []).map((opt) => (
						<button
							key={opt.code}
							type="button"
							className={opt.code === selectedStandingsLeague ? 'league-tab league-tab--active' : 'league-tab'}
							onClick={() => setSelectedStandingsLeague(opt.code)}
						>
							{opt.label}
						</button>
					))}
				</div>

				{standingsError ? (
					<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 4px 0 4px' }}>
						{standingsError}
					</div>
				) : null}

				{showStandings ? (
					<div style={{ marginTop: 12 }}>
						{standingsLoading ? (
							<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>Loading standings…</div>
						) : !standingsData || !Array.isArray(standingsData.tables) || standingsData.tables.length === 0 ? (
							<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>No standings available</div>
						) : (
							standingsData.tables.slice(0, 2).map((table, tIdx) => (
								<div key={`${table.name}-${tIdx}`} style={{ marginBottom: 12 }}>
									<div className="league-header" style={{ borderRadius: 20 }}>
										<div>
											<div className="league-title">{table.name}</div>
											<div className="league-season" style={{ color: 'rgba(255,255,255,0.54)' }}>{standingsData.title}</div>
										</div>
									</div>
									<div className="league-table">
										{table.entries.slice(0, 10).map((row, idx) => {
											const team = row.team || {};
											const badge = team.logo || '/assets/club/placeholder.svg';
											const club = team.shortName || team.name || team.abbr || '—';
											const points = getStatDisplay(row, ['points', 'pts']);
											const wins = getStatDisplay(row, ['wins', 'win']);
											const losses = getStatDisplay(row, ['losses', 'loss']);
											const ties = getStatDisplay(row, ['ties', 'draws']);
											const played = getStatDisplay(row, ['gamesPlayed', 'games', 'gp']);
											const isSoccer = selectedStandingsSport === 'soccer';

											const pct = getStatDisplay(row, ['winPercent', 'pct']);
											let rightLabel: string | null = null;
											if (isSoccer) {
												rightLabel = played ? `GP ${played}` : null;
											} else {
												rightLabel = pct ? `PCT ${pct}` : null;
											}

											return (
												<div className="league-row" key={`${row.rank}-${club}-${idx}`}>
													<div className="league-pos">{row.rank ?? idx + 1}</div>
													<div className="league-club">
														<img src={badge} alt={club} style={{ width: 22, height: 22, borderRadius: 4 }} />
														<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
															<span style={{ fontSize: 13 }}>{club}</span>
															{played ? (
																<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.54)' }}>
																	{isSoccer ? `GP ${played}` : played ? `GP ${played}` : null}
																</span>
															) : null}
														</div>
													</div>
													<div className="league-points">
														{isSoccer
															? (points ?? '—')
															: `${wins ?? '–'}-${losses ?? '–'}${ties && ties !== '0' ? `-${ties}` : ''}`}
													</div>
													{rightLabel ? (
														<div style={{ width: 84, textAlign: 'right', color: 'rgba(255,255,255,0.54)', fontSize: 11 }}>
															{rightLabel}
														</div>
													) : null}
												</div>
											);
										})}
									</div>
								</div>
							))
						)
					}
					</div>
				) : (
					<div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 12, padding: '8px 6px' }}>
						Click the arrow to show standings
					</div>
				)}
			</div>
		</div>
	);
};

export default RightWidgetPanel;

 
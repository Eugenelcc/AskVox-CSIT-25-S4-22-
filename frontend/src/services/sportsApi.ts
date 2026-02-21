export type SportKey = 'soccer' | 'nba' | 'nfl' | 'mlb';

export type StandingsSportKey = 'soccer' | 'nba' | 'nfl' | 'mlb';

export interface SportsTeam {
	name?: string | null;
	shortName?: string | null;
	abbr?: string | null;
	logo?: string | null;
	score?: number | null;
}

export interface SportsEvent {
	id?: string | null;
	name?: string | null;
	date?: string | null; // ISO
	status?: {
		state?: string | null; // 'pre' | 'in' | 'post'
		detail?: string | null;
		shortDetail?: string | null;
	} | null;
	home?: SportsTeam | null;
	away?: SportsTeam | null;
}

export interface SportsScoreboardResponse {
	sport: SportKey;
	league: string;
	title: string;
	fetchedAt: string;
	live: SportsEvent[];
	upcoming: SportsEvent[];
	recent: SportsEvent[];
}

export interface StandingsTeam {
	name?: string | null;
	shortName?: string | null;
	abbr?: string | null;
	logo?: string | null;
}

export interface StandingsStat {
	value?: number | string | null;
	display?: string | null;
	abbr?: string | null;
}

export interface StandingsEntry {
	rank: number;
	team: StandingsTeam;
	stats: Record<string, StandingsStat>;
}

export interface StandingsTable {
	name: string;
	entries: StandingsEntry[];
}

export interface SportsStandingsResponse {
	sport: StandingsSportKey;
	league: string;
	title: string;
	fetchedAt: string;
	tables: StandingsTable[];
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchSportsScoreboard(options: {
	sport: SportKey;
	signal?: AbortSignal;
	league?: string;
}): Promise<SportsScoreboardResponse> {
	const { sport, signal, league } = options;
	const url = new URL(`${API_BASE_URL}/sports/scoreboard/${sport}`);
	if (league) url.searchParams.set('league', league);

	const res = await fetch(url.toString(), { method: 'GET', signal });
	if (!res.ok) {
		throw new Error(`Sports request failed: ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as SportsScoreboardResponse;
}

export async function fetchSportsStandings(options: {
	sport: StandingsSportKey;
	signal?: AbortSignal;
	league?: string;
}): Promise<SportsStandingsResponse> {
	const { sport, signal, league } = options;
	const url = new URL(`${API_BASE_URL}/sports/standings/${sport}`);
	if (league) url.searchParams.set('league', league);

	const res = await fetch(url.toString(), { method: 'GET', signal });
	if (!res.ok) {
		throw new Error(`Standings request failed: ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as SportsStandingsResponse;
}

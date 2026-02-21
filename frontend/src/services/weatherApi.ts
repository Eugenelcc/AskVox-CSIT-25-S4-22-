export type WeatherIcon = 'cloudy' | 'sunny' | 'rainy' | 'thunder' | 'fog' | 'snow';

export type WeatherCode = number;

export interface OpenMeteoForecastResponse {
	latitude: number;
	longitude: number;
	timezone: string;
	current?: {
		time: string;
		temperature_2m: number;
		weather_code: WeatherCode;
	};
	daily?: {
		time: string[];
		temperature_2m_max: number[];
		temperature_2m_min: number[];
		weather_code: WeatherCode[];
	};
}

export interface ReverseGeocodeResponse {
	locality?: string;
	city?: string;
	principalSubdivision?: string;
	countryName?: string;
}

export interface WeatherCodeInfo {
	label: string;
	icon: WeatherIcon;
}

export function weatherCodeToInfo(code: WeatherCode): WeatherCodeInfo {
	// Open-Meteo weather codes: https://open-meteo.com/en/docs
	if (code === 0) return { label: 'Clear', icon: 'sunny' };
	if (code === 1 || code === 2) return { label: 'Partly cloudy', icon: 'cloudy' };
	if (code === 3) return { label: 'Cloudy', icon: 'cloudy' };
	if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
	if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Drizzle', icon: 'rainy' };
	if ([61, 63, 65, 66, 67].includes(code)) return { label: 'Rain', icon: 'rainy' };
	if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snow', icon: 'snow' };
	if ([80, 81, 82].includes(code)) return { label: 'Rain showers', icon: 'rainy' };
	if ([95, 96, 99].includes(code)) return { label: 'Thunderstorm', icon: 'thunder' };
	return { label: 'Unknown', icon: 'cloudy' };
}

export async function fetchOpenMeteoForecast(options: {
	latitude: number;
	longitude: number;
	signal?: AbortSignal;
}): Promise<OpenMeteoForecastResponse> {
	const { latitude, longitude, signal } = options;
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', String(latitude));
	url.searchParams.set('longitude', String(longitude));
	url.searchParams.set('current', 'temperature_2m,weather_code');
	url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code');
	url.searchParams.set('timezone', 'auto');

	const res = await fetch(url.toString(), { signal });
	if (!res.ok) {
		throw new Error(`Open-Meteo request failed: ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as OpenMeteoForecastResponse;
}

export async function reverseGeocodeBigDataCloud(options: {
	latitude: number;
	longitude: number;
	signal?: AbortSignal;
}): Promise<ReverseGeocodeResponse> {
	const { latitude, longitude, signal } = options;
	const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
	url.searchParams.set('latitude', String(latitude));
	url.searchParams.set('longitude', String(longitude));
	url.searchParams.set('localityLanguage', 'en');

	const res = await fetch(url.toString(), { signal });
	if (!res.ok) {
		throw new Error(`Reverse geocode failed: ${res.status} ${res.statusText}`);
	}
	const data: unknown = await res.json();
	const record = (value: unknown): Record<string, unknown> =>
		value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const obj = record(data);
	return {
		locality: typeof obj.locality === 'string' ? obj.locality : undefined,
		city: typeof obj.city === 'string' ? obj.city : undefined,
		principalSubdivision: typeof obj.principalSubdivision === 'string' ? obj.principalSubdivision : undefined,
		countryName: typeof obj.countryName === 'string' ? obj.countryName : undefined,
	};
}

export function formatLocationLabel(place: ReverseGeocodeResponse | null | undefined): string {
	if (!place) return 'Unknown location';
	const locality = place.locality || place.city;
	const subdivision = place.principalSubdivision;
	const parts = [locality, subdivision].filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

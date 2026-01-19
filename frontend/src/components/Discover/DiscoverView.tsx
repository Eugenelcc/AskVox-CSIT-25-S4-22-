import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import './DiscoverNews.css';
import { Globe, TrendingUp, ChevronDown, RefreshCw, MapPin } from 'lucide-react'; 
import NewsCard from './NewsCard';
import RightWidgetPanel from './RightWidgetPanel';
import type { WeatherSummary, Standing, MatchItem } from './RightWidgetPanel';
import type { NewsArticle } from '../../services/newsApi';
import { fetchNews } from '../../services/newsApi';

// --- HELPERS ---

// 🟢 NEW: Supported Countries Configuration
const COUNTRIES = [
    { code: '', label: 'Global 🌍' },
    { code: 'us', label: 'United States 🇺🇸' },
    { code: 'gb', label: 'United Kingdom 🇬🇧' },
    { code: 'sg', label: 'Singapore 🇸🇬' },
    { code: 'in', label: 'India 🇮🇳' },
    { code: 'au', label: 'Australia 🇦🇺' },
    { code: 'ca', label: 'Canada 🇨🇦' },
    { code: 'jp', label: 'Japan 🇯🇵' },
];

type CardData = {
    variant: 'hero' | 'standard' | 'wide';
    imageUrl: string;
    title: string;
    description?: string;
    releasedMinutes: number;
    publishedAt?: string;
    bookmarked: boolean;
    source?: string;
    url?: string;
    // 🟢 NEW
    all_sources?: { title: string; url: string; source: string }[];
};

const sortArticles = (articles: NewsArticle[], mode: 'Trending' | 'Latest') => {
    const sorted = [...articles];
    if (mode === 'Latest') {
        return sorted.sort((a, b) => {
            const tA = a.publishedAt ? a.publishedAt.replace(" ", "T") : "";
            const tB = b.publishedAt ? b.publishedAt.replace(" ", "T") : "";
            const dateA = new Date(tA).getTime() || 0;
            const dateB = new Date(tB).getTime() || 0;
            return dateB - dateA;
        });
    } else {
        return sorted.sort(() => 0.5 - Math.random());
    }
};

function minutesFromNow(iso: string | undefined, now: number): number {
    if (!iso) return 0;
    try {
        // Ensure ISO format compatibility without breaking timezone offsets
        const hasTzOffset = /[+-]\d{2}:?\d{2}$/.test(iso);
        const cleanIso = iso.replace(' ', 'T') + (iso.includes('Z') || hasTzOffset ? '' : 'Z');
        const t = new Date(cleanIso).getTime();
        
        // 🟢 FIX: Check for Invalid Date
        if (isNaN(t)) return NaN;

        const diff = Math.round((now - t) / 60000);
        return Math.max(0, diff);
    } catch {
        return NaN;
    }
}
export interface DiscoverViewProps {
    withNavOffset?: boolean;
    category?: string | null;
    feedCount?: number;
}

const DiscoverView: React.FC<DiscoverViewProps> = ({ withNavOffset, category, feedCount = 2 }) => {
    const [trend, setTrend] = useState<'Trending' | 'Latest'>('Trending');
    
    // 🟢 CHANGE: Country State
    const [selectedCountry, setSelectedCountry] = useState<string>(''); // Default '' is Global
    const [showCountryMenu, setShowCountryMenu] = useState(false);
    
    const [rawArticles, setRawArticles] = useState<NewsArticle[]>([]);
    const [displayedArticles, setDisplayedArticles] = useState<NewsArticle[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

    // Ref for click-outside detection
    const countryMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 60000); 
        return () => clearInterval(timer);
    }, []);


    useEffect(() => {
    console.log("Fetched Articles: ", rawArticles.length);
    console.log("Displayed Articles: ", displayedArticles.length);
}, [rawArticles, displayedArticles]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (countryMenuRef.current && !countryMenuRef.current.contains(event.target as Node)) {
                setShowCountryMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- 2. UPDATED FETCH FUNCTION ---
    const loadData = useCallback(() => {
        console.log("🚀 FRONTEND: loadData() triggered!");
        setIsLoading(true);
        const targetCategory = category || 'Trending';

        console.log(`🚀 FRONTEND: Calling fetchNews('${targetCategory}', '${selectedCountry}')...`);

        // 🟢 CHANGE: Pass selectedCountry to the API call
        fetchNews(targetCategory, selectedCountry)
            .then((data) => {
                console.log("✅ FRONTEND: Data received!", data);
                const articles = Array.isArray(data) ? data : [];
                setRawArticles(articles);
                setDisplayedArticles(sortArticles(articles, trend)); 
            })
            .catch((err) => {
                console.error("❌ FRONTEND ERROR:", err);
                setRawArticles([]);
                setDisplayedArticles([]);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [category, trend, selectedCountry]); // 🟢 Add selectedCountry to dependencies

    // 3. Initial Load & Refresh on Country Change
    useEffect(() => {
        loadData();
    }, [category, selectedCountry]); // 🟢 Reload when country changes

    const onManualRefresh = () => {
        loadData();
    };

    const handleTrendToggle = () => {
        const newTrend = trend === 'Trending' ? 'Latest' : 'Trending';
        setTrend(newTrend);
        const newOrder = sortArticles(rawArticles, newTrend);
        setDisplayedArticles(newOrder);
    };

   // --- RENDER HELPERS ---
    const toCard = useCallback((article: any, variant: CardData['variant']): CardData => {
        
        // 🟢 FIX: Use || instead of ?? to catch empty strings ("")
        // Added a high-quality abstract news fallback from Unsplash
        const validImage = article.imageUrl && article.imageUrl.startsWith('http') 
            ? article.imageUrl 
            : 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1000&auto=format&fit=crop';

        return {
            variant,
            imageUrl: validImage,
            title: article.title,
            description: article.description,
            releasedMinutes: minutesFromNow(article.publishedAt, currentTime),
            publishedAt: article.publishedAt,
            bookmarked: false,
            source: article.source,
            url: article.url,
            // @ts-ignore
            all_sources: article.all_sources 
        };
    }, [currentTime]);

    const feedSets = useMemo(() => {
        if (!displayedArticles || displayedArticles.length === 0) return [];
        const sets: Array<{ hero: CardData; standards: CardData[]; wide?: CardData }> = [];
        for (let i = 0; i < displayedArticles.length; i += 5) {
            const chunk = displayedArticles.slice(i, i + 5);
            if (chunk.length === 0) continue;
            const h = toCard(chunk[0], 'hero');
            const std = chunk.slice(1, 4).map((a) => toCard(a, 'standard'));
            const wArticle = chunk[4]; 
            if (wArticle) {
                 const w = toCard(wArticle, 'wide');
                 sets.push({ hero: h, standards: std, wide: w });
            } else {
                 sets.push({ hero: h, standards: std }); 
            }
        }
        return sets;
    }, [displayedArticles, toCard]); 

    // ... (Weather/Standing Data code omitted for brevity - keep your existing code) ...
    const weather: WeatherSummary = { location: 'Serangoon North Estate', temp: 27, condition: 'Cloudy', high: 31, low: 24, weekly: [{ day: 'Mon', temp: 31 }, { day: 'Tue', temp: 30 }, { day: 'Wed', temp: 30 }, { day: 'Thu', temp: 29 }, { day: 'Fri', temp: 29 }] };
    const standings: Standing[] = [{ position: 1, club: 'Arsenal', badgeUrl: '/assets/club/arsenal.png', points: 30 }, { position: 2, club: 'Man City', badgeUrl: '/assets/club/manchester-city.png', points: 25 }, { position: 3, club: 'Chelsea', badgeUrl: '/assets/club/chelsea.png', points: 24 }, { position: 4, club: 'Aston Villa', badgeUrl: '/assets/club/aston-villa.png', points: 24 }, { position: 5, club: 'Brighton', badgeUrl: '/assets/club/brighton.png', points: 22 }, { position: 6, club: 'Sunderland', badgeUrl: '/assets/club/sunderland.png', points: 22 }, { position: 7, club: 'Man United', badgeUrl: '/assets/club/manchester-united.png', points: 21 }];
    const upcoming: MatchItem[] = [{ home: 'Fulham', homeBadgeUrl: '/assets/club/fulham.png', away: 'Man City', awayBadgeUrl: '/assets/club/manchester-city.png', dateLabel: 'Tomorrow', timeLabel: '3:30 am' }, { home: 'Bournemouth', homeBadgeUrl: '/assets/club/bournemouth.png', away: 'Everton', awayBadgeUrl: '/assets/club/everton.png', dateLabel: 'Tomorrow', timeLabel: '3:30 am' }, { home: 'Newcastle', homeBadgeUrl: '/assets/club/newcastle-united.png', away: 'Tottenham', awayBadgeUrl: '/assets/club/tottenham-hotspur.png', dateLabel: 'Tomorrow', timeLabel: '4:15 am' }, { home: 'Brighton', homeBadgeUrl: '/assets/club/brighton.png', away: 'Aston Villa', awayBadgeUrl: '/assets/club/aston-villa.png', dateLabel: 'Thu, 4 Dec', timeLabel: '3:30 am' }];
    const containerStyle: React.CSSProperties = withNavOffset ? { paddingLeft: 80 } : {};

    // Helper to get label for current country
    const currentCountryLabel = COUNTRIES.find(c => c.code === selectedCountry)?.label || 'Global 🌍';

    return (
        <div className="discover-root" style={containerStyle}>
            <div className="discover-header">
                <div className="discover-header__left">
                    <Globe color="#FF951C" />
                    <div className="discover-title">Discover</div>
                    
                    <button 
                        className="pill pill--ghost" 
                        onClick={onManualRefresh}
                        style={{ padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Refresh News"
                    >
                        <RefreshCw size={16} />
                    </button>

                    <button className="pill pill--ghost" onClick={handleTrendToggle}>
                        {trend} <TrendingUp size={16} />
                    </button>

                    {/* 🟢 NEW: Country Dropdown */}
                    <div style={{ position: 'relative' }} ref={countryMenuRef}>
                        <button 
                            className="pill pill--ghost" 
                            onClick={() => setShowCountryMenu(!showCountryMenu)}
                            style={{ minWidth: '140px', justifyContent: 'space-between' }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {/* <MapPin size={14} /> */}
                                {currentCountryLabel}
                            </span>
                            <ChevronDown size={16} />
                        </button>

                        {showCountryMenu && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '8px',
                                background: '#1B1A1A',
                                border: '1px solid #333',
                                borderRadius: '12px',
                                padding: '8px',
                                zIndex: 100,
                                minWidth: '160px',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px'
                            }}>
                                {COUNTRIES.map((c) => (
                                    <div 
                                        key={c.code}
                                        onClick={() => {
                                            setSelectedCountry(c.code);
                                            setShowCountryMenu(false);
                                        }}
                                        style={{
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            color: selectedCountry === c.code ? '#FF951C' : '#fff',
                                            backgroundColor: selectedCountry === c.code ? 'rgba(255, 149, 28, 0.1)' : 'transparent',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedCountry === c.code ? 'rgba(255, 149, 28, 0.1)' : 'transparent'}
                                    >
                                        {c.label}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {category ? <span style={{ color: '#FF951C', marginLeft: 8, fontSize: 14 }}>Category: {category}</span> : null}
                </div>
            </div>

            <div className="discover-layout">
                <div className="discover-left">
                    {/* Loading & Empty States */}
                    {isLoading && feedSets.length === 0 && (
                        <div style={{ color: '#C0C0C0', marginBottom: 16, padding: '20px', textAlign: 'center' }}>
                            Loading news...
                        </div>
                    )}
                    
                    {!isLoading && feedSets.length === 0 && (
                        <div style={{ color: '#888', padding: '40px', textAlign: 'center' }}>
                            No articles found for this region.
                        </div>
                    )}

                    {/* Content */}
                    {feedSets.map((set, setIdx) => (
                        <div className="discover-feed" key={`feed-set-${setIdx}`}>
                            <NewsCard {...set.hero} />
                            <div style={{ height: 24 }} />
                            <div className="news-grid">
                                {set.standards.map((c, idx) => (
                                    <NewsCard key={`feed-${setIdx}-std-${idx}`} {...c} />
                                ))}
                            </div>
                            <div style={{ marginTop: 24 }}>
                                {set.wide && <NewsCard {...set.wide} />}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="discover-right-panel">
                    <RightWidgetPanel weather={weather} standings={standings} upcoming={upcoming} />
                </div>
            </div>
        </div>
    );
};

export { DiscoverView };
export default DiscoverView;
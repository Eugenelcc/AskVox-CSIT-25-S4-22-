import React, { useEffect, useMemo, useState, useCallback } from 'react';
import './DiscoverNews.css';
import { Globe, TrendingUp, ChevronDown, RefreshCw } from 'lucide-react';
import NewsCard from './NewsCard';
import RightWidgetPanel from './RightWidgetPanel';
import type { WeatherSummary, Standing, MatchItem } from './RightWidgetPanel';
import type { NewsArticle } from '../../services/newsApi';
import { fetchNews } from '../../services/newsApi';

// --- HELPERS ---

type CardData = {
    variant: 'hero' | 'standard' | 'wide';
    imageUrl: string;
    title: string;
    description?: string;
    releasedMinutes: number;
    bookmarked: boolean;
    source?: string;
    url?: string; 
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
    const cleanIso = iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z');
    const t = new Date(cleanIso).getTime();
    const diff = Math.round((now - t) / 60000);
    return Math.max(0, diff);
}

export interface DiscoverViewProps {
    withNavOffset?: boolean;
    category?: string | null;
    feedCount?: number;
}

const DiscoverView: React.FC<DiscoverViewProps> = ({ withNavOffset, category, feedCount = 2 }) => {
    const [trend, setTrend] = useState<'Trending' | 'Latest'>('Trending');
    const [domain, setDomain] = useState<string>('Domains');
    
    const [rawArticles, setRawArticles] = useState<NewsArticle[]>([]);
    const [displayedArticles, setDisplayedArticles] = useState<NewsArticle[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 60000); 
        return () => clearInterval(timer);
    }, []);

    // --- 2. SHARED FETCH FUNCTION (WITH DEBUG LOGS) ---
    const loadData = useCallback(() => {
        console.log("🚀 FRONTEND: loadData() triggered!");
        setIsLoading(true);
        const targetCategory = category || 'Trending';

        console.log(`🚀 FRONTEND: Calling fetchNews('${targetCategory}')...`);

        fetchNews(targetCategory)
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
    }, [category, trend]);

    // 3. Initial Load
    useEffect(() => {
        loadData();
    }, [category]); 

    // 4. Refresh Button Handler
    const onManualRefresh = () => {
        console.log("🖱️ BUTTON CLICKED!");
        loadData();
    };

    const handleTrendToggle = () => {
        const newTrend = trend === 'Trending' ? 'Latest' : 'Trending';
        setTrend(newTrend);
        const newOrder = sortArticles(rawArticles, newTrend);
        setDisplayedArticles(newOrder);
    };

    // --- RENDER HELPERS ---
    const toCard = useCallback((article: NewsArticle, variant: CardData['variant']): CardData => {
        return {
            variant,
            imageUrl: article.imageUrl ?? '/assets/hero-verstappen.jpg',
            title: article.title,
            description: article.description,
            releasedMinutes: minutesFromNow(article.publishedAt, currentTime),
            bookmarked: false,
            source: article.source,
            url: article.url, 
        };
    }, [currentTime]);

    const feedSets = useMemo(() => {
        if (!displayedArticles || displayedArticles.length === 0) return [];

        // ✅ FIX 1: Make 'wide' optional with '?' so we don't force it
        const sets: Array<{ hero: CardData; standards: CardData[]; wide?: CardData }> = [];
        
        for (let i = 0; i < displayedArticles.length; i += 5) {
            const chunk = displayedArticles.slice(i, i + 5);
            if (chunk.length === 0) continue;

            const h = toCard(chunk[0], 'hero');
            const std = chunk.slice(1, 4).map((a) => toCard(a, 'standard'));
            
            // Get the 5th item (index 4) if it exists
            const wArticle = chunk[4]; 
            
            if (wArticle) {
                 const w = toCard(wArticle, 'wide');
                 sets.push({ hero: h, standards: std, wide: w });
            } else {
                 // ✅ FIX 2: If no 5th item, simply do NOT add a 'wide' property.
                 // This prevents the code from duplicating 'h' (hero) into the 'wide' slot.
                 sets.push({ hero: h, standards: std }); 
            }
        }
        return sets;
    }, [displayedArticles, toCard]); 

    const weather: WeatherSummary = {
        location: 'Serangoon North Estate',
        temp: 27,
        condition: 'Cloudy',
        high: 31,
        low: 24,
        weekly: [
            { day: 'Mon', temp: 31 }, { day: 'Tue', temp: 30 },
            { day: 'Wed', temp: 30 }, { day: 'Thu', temp: 29 }, { day: 'Fri', temp: 29 },
        ],
    };

    const standings: Standing[] = [
        { position: 1, club: 'Arsenal', badgeUrl: '/assets/club/arsenal.png', points: 30 },
        { position: 2, club: 'Man City', badgeUrl: '/assets/club/manchester-city.png', points: 25 },
        { position: 3, club: 'Chelsea', badgeUrl: '/assets/club/chelsea.png', points: 24 },
        { position: 4, club: 'Aston Villa', badgeUrl: '/assets/club/aston-villa.png', points: 24 },
        { position: 5, club: 'Brighton', badgeUrl: '/assets/club/brighton.png', points: 22 },
        { position: 6, club: 'Sunderland', badgeUrl: '/assets/club/sunderland.png', points: 22 },
        { position: 7, club: 'Man United', badgeUrl: '/assets/club/manchester-united.png', points: 21 },
    ];

    const upcoming: MatchItem[] = [
        { home: 'Fulham', homeBadgeUrl: '/assets/club/fulham.png', away: 'Man City', awayBadgeUrl: '/assets/club/manchester-city.png', dateLabel: 'Tomorrow', timeLabel: '3:30 am' },
        { home: 'Bournemouth', homeBadgeUrl: '/assets/club/bournemouth.png', away: 'Everton', awayBadgeUrl: '/assets/club/everton.png', dateLabel: 'Tomorrow', timeLabel: '3:30 am' },
        { home: 'Newcastle', homeBadgeUrl: '/assets/club/newcastle-united.png', away: 'Tottenham', awayBadgeUrl: '/assets/club/tottenham-hotspur.png', dateLabel: 'Tomorrow', timeLabel: '4:15 am' },
        { home: 'Brighton', homeBadgeUrl: '/assets/club/brighton.png', away: 'Aston Villa', awayBadgeUrl: '/assets/club/aston-villa.png', dateLabel: 'Thu, 4 Dec', timeLabel: '3:30 am' },
    ];

    const containerStyle: React.CSSProperties = withNavOffset ? { paddingLeft: 80 } : {};

    return (
        <div className="discover-root" style={containerStyle}>
            <div className="discover-header">
                <div className="discover-header__left">
                    <Globe color="#FF951C" />
                    <div className="discover-title">Discover</div>
                    
                    {/* --- 5. THE REFRESH BUTTON --- */}
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

                    <button className="pill pill--ghost" onClick={() => setDomain('Domains')}>
                        {domain} <ChevronDown size={16} />
                    </button>
                    {category ? <span style={{ color: '#FF951C', marginLeft: 8, fontSize: 14 }}>Category: {category}</span> : null}
                </div>
            </div>

            <div className="discover-layout">
                <div className="discover-left">
                    {/* Loading State */}
                    {isLoading && feedSets.length === 0 && (
                        <div style={{ color: '#C0C0C0', marginBottom: 16, padding: '20px', textAlign: 'center' }}>
                            Loading news...
                        </div>
                    )}
                    
                    {/* Empty State */}
                    {!isLoading && feedSets.length === 0 && (
                        <div style={{ color: '#888', padding: '40px', textAlign: 'center' }}>
                            No articles found.
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
                                {/* ✅ FIX 3: Only render if 'wide' exists */}
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
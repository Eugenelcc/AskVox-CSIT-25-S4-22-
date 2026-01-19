import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Clock } from 'lucide-react'; 
import './DiscoverNews.css';

export interface NewsCardProps {
    variant: 'hero' | 'standard' | 'wide';
    imageUrl: string;
    title: string;
    description?: string;
    releasedMinutes: number;
    publishedAt?: string;
    bookmarked: boolean;
    source?: string;
    url?: string;
    // 🟢 NEW: Array of sources from the AI cluster
    all_sources?: { title: string; url: string; source: string; domain_url?: string }[];
}

// --- 1. Helper Functions ---

const getDomain = (link?: string) => {
    if (!link) return '';
    try { return new URL(link).hostname.replace('www.', ''); } catch { return ''; }
};

const getFaviconUrl = (link?: string, domainUrl?: string) => {
    // 1. Try backend-provided publisher homepage first (most accurate)
    if (domainUrl) {
         try {
             const domain = new URL(domainUrl).hostname;
             return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
         } catch {}
    }
    // 2. Fallback to extracting domain from article link
    const domain = getDomain(link);
    return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
};

const formatTime = (mins: number) => {
    if (isNaN(mins) || mins === 0) return 'Just now'; // Handle NaN or 0
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
};

// --- 2. Sub-Component (Footer) ---

interface CardFooterProps {
    url?: string;
    source?: string;
    releasedMinutes: number;
    bookmarked: boolean;
    all_sources?: NewsCardProps['all_sources'];
}

const CardFooter: React.FC<CardFooterProps> = ({ url, source, releasedMinutes, bookmarked, all_sources }) => {
    const isCluster = all_sources && all_sources.length > 1;

    return (
        <div className="news-meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isCluster ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {/* 1. Display 3 source icons */}
                        <div style={{ display: 'flex', marginRight: '4px' }}>
                            {all_sources.slice(0, 3).map((src, i) => (
                                <img 
                                    key={i}
                                    src={getFaviconUrl(src.url, src.domain_url)} 
                                    alt=""
                                    style={{
                                        width: 18, height: 18, borderRadius: '50%',
                                        marginLeft: i > 0 ? '-8px' : '0', // Overlap
                                        zIndex: 3 - i
                                    }}
                                    onError={(e) => e.currentTarget.style.display = 'none'}
                                />
                            ))}
                        </div>
                        {/* 2. Display the source count */}
                        <span style={{ color: '#aaa', fontWeight: 500, fontSize: '13px' }}>
                            {all_sources.length} sources
                        </span>
                    </div>
                ) : (
                    <div>{source}</div>  // Single source
                )}
            </div>
        </div>
    );
};

// --- 3. Main Component ---

const NewsCard: React.FC<NewsCardProps> = ({ 
    variant, 
    imageUrl, 
    title, 
    description, 
    releasedMinutes, 
    publishedAt,
    bookmarked,
    source,
    url,
    all_sources // 🟢 Receive the sources
}) => {
    const navigate = useNavigate();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'article';

    const goDetail = () => {
        navigate(`/discover/news/${slug}`, {
            state: {
                // Pass everything to the detail page so it can render the "Analysis" view
                article: { title, description, imageUrl, releasedMinutes, publishedAt, source, url, all_sources }
            }
        });
    };
    
    // Pass all_sources to the footer
    const footerProps = { url, source, releasedMinutes, bookmarked, all_sources };

    if (variant === 'hero') {
        return (
            <div className="news-card news-card--hero" onClick={goDetail} style={{ cursor: 'pointer' }}>
                <img src={imageUrl} alt={title} className="news-card__image" />
                <div className="news-card__body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <h3 className="news-title news-title--lg news-title-gradient">{title}</h3>
                    {description && <p className="news-desc" style={{ marginTop: 12 }}>{description.slice(0, 150)}...</p>}
                    <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                        <CardFooter {...footerProps} />
                    </div>
                </div>
            </div>
        );
    }

    if (variant === 'wide') {
        return (
            <div className="news-card news-card--wide" onClick={goDetail} style={{ cursor: 'pointer' }}>
                <img src={imageUrl} alt={title} className="news-card__image" />
                <div className="news-card__body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <h3 className="news-title news-title--lg">{title}</h3>
                    {description && <p className="news-desc" style={{ marginTop: 12 }}>{description}</p>}
                    <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                        <CardFooter {...footerProps} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="news-card" onClick={goDetail} style={{ cursor: 'pointer' }}>
            <img src={imageUrl} alt={title} className="news-card__image" style={{ height: 160 }} />
            <div className="news-card__body">
                <h3 className="news-title" style={{ fontSize: 16, lineHeight: '1.4em', marginBottom: 12 }}>
                    {title.length > 60 ? title.slice(0, 60) + '...' : title}
                </h3>
                <CardFooter {...footerProps} />
            </div>
        </div>
    );
};

export default NewsCard;
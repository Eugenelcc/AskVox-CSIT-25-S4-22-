import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Clock } from 'lucide-react'; // Changed Bookmark to Heart
import './DiscoverNews.css';

export interface NewsCardProps {
    variant: 'hero' | 'standard' | 'wide';
    imageUrl: string;
    title: string;
    description?: string;
    releasedMinutes: number;
    bookmarked: boolean;
    source?: string;
    url?: string;
}

// --- 1. Helper Functions ---

const getDomain = (link?: string) => {
    if (!link) return '';
    try {
        return new URL(link).hostname.replace('www.', '');
    } catch  {
        return '';
    }
};

const getFaviconUrl = (link?: string) => {
    const domain = getDomain(link);
    if (!domain) return '';
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
};

const formatSource = (src?: string, url?: string) => {
    // If no source name, try to use the domain name
    if (!src) return getDomain(url) || 'News';
    return src
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const formatTime = (mins: number) => {
    if (mins < 60) {
        return `${mins}m ago`;
    }
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
};

// --- 2. Sub-Component (Footer) ---

interface CardFooterProps {
    url?: string;
    source?: string;
    releasedMinutes: number;
    bookmarked: boolean;
}

const CardFooter: React.FC<CardFooterProps> = ({ url, source, releasedMinutes, bookmarked }) => (
    <div className="news-meta">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Source Icon - Only shows if URL exists */}
            {url && (
                <img 
                    src={getFaviconUrl(url)} 
                    alt="" 
                    style={{ width: 16, height: 16, borderRadius: '2px', objectFit: 'contain' }} 
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                />
            )}
            
            {/* Source Name & Time */}
            <span style={{ color: '#FF951C', fontWeight: 500 }}>
                {formatSource(source, url)}
            </span>
            <span style={{ margin: '0 4px', opacity: 0.4 }}>•</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={12} /> {formatTime(releasedMinutes)}
            </span>
        </div>
        
        {/* Heart Icon (Orange when bookmarked) */}
        <button className="icon-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <Heart 
                size={18} 
                color={bookmarked ? '#FF951C' : 'rgba(255,255,255,0.6)'} 
                fill={bookmarked ? '#FF951C' : 'none'} 
            />
        </button>
    </div>
);

// --- 3. Main Component ---

const NewsCard: React.FC<NewsCardProps> = ({ 
    variant, 
    imageUrl, 
    title, 
    description, 
    releasedMinutes, 
    bookmarked,
    source,
    url 
}) => {
    const navigate = useNavigate();
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'article';

    const goDetail = () => {
        navigate(`/discover/news/${slug}`, {
            state: {
                article: { title, description, imageUrl, releasedMinutes, source, url }
            }
        });
    };
    
    const footerProps = { url, source, releasedMinutes, bookmarked };

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

    // Standard Variant
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
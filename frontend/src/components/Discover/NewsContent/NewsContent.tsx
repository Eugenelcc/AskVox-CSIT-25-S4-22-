import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Heart, Share2, Mic, Puzzle, Send, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import './NewsContent.css';

type ArticleViewModel = {
  title: string;
  description?: string;
  imageUrl?: string;
  releasedMinutes?: number;
  source?: string;
  url?: string;
};

const fallbackArticle: ArticleViewModel = {
  title: 'No Article Selected',
  description: "Please select an article from the Discover feed.",
  imageUrl: '',
  releasedMinutes: 0,
  source: 'AskVox News',
};

const NewsContent: React.FC = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const article: ArticleViewModel = (state?.article as ArticleViewModel) || fallbackArticle;
  const releasedLabel = typeof article.releasedMinutes === 'number' ? `Released ${article.releasedMinutes} minutes ago` : 'Just released';

  // --- CONTENT STATE ---
  const [fullText, setFullText] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  
  const hasFetched = useRef(false);
  const chatBarRef = useRef<HTMLDivElement | null>(null);

  // --- HELPER: SOURCE PILL ---
  const getSourceDetails = () => {
      if (!article.url) return { domain: '', favicon: '' };
      try {
          const { hostname } = new URL(article.url);
          const favicon = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`; 
          return { domain: hostname, favicon };
      } catch {
          return { domain: '', favicon: '' };
      }
  };
  const { favicon } = getSourceDetails();
  const sourceName = article.source 
    ? article.source.charAt(0).toUpperCase() + article.source.slice(1) 
    : "News Source";

  // --- 🔴 REFINED CLEANER (Fixes "Read More" & Privacy Spam) ---
  const cleanJinaOutput = (markdown: string, currentTitle: string) => {
      if (!markdown) return [];

      const rawLines = markdown.split('\n');
      const uniqueLines = new Set<string>();
      const cleanLines: string[] = [];
      const normTitle = currentTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 1. SECURITY CHECK (Cloudflare)
      const lowerFullText = markdown.toLowerCase();
      if (
          lowerFullText.includes("verify you are human") ||
          lowerFullText.includes("needs to review the security") ||
          lowerFullText.includes("cloudflare")
      ) {
          console.warn("⚠️ Article blocked by Cloudflare.");
          return []; 
      }

      for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i];
          let trimmed = line.trim();
          let lower = trimmed.toLowerCase();

          // 2. FILTER NOTIFICATIONS & PRIVACY SPAM
          if (lower.includes("browser doesn't support push notifications")) continue;
          if (lower.includes("manage your notification settings")) continue;
          if (lower.includes('opt out of the sale')) continue;  
          if (lower.includes('we won\'t sell or share')) continue; 
          if (lower.includes('interest-based ads')) continue; 
          if (lower.includes('subscribe now')) continue;
          if (lower.includes('create an account')) continue;
          if (lower.includes('sign in to continue')) continue;
          if (lower.includes('exclusive articles from')) continue;
          if (lower.includes('unlimited online access')) continue;
          
          // 🟢 NEW FILTERS FOR YOUR SCREENSHOTS
          if (lower.includes("this site collects information")) continue;
          if (lower.includes("privacy policy")) continue;
          if (lower.includes("terms of service")) continue;
          if (trimmed === "^ $1" || trimmed === "$1") continue; // Regex artifact fix

          // 3. FILTER "READ MORE" GLITCHES
          if (lower.includes('read more') && lower.includes(normTitle)) continue; 
          if (lower.includes('ofread more')) continue; 

          // 4. FILTER BULLET ADS
          if (trimmed.startsWith('* ') && (
              lower.includes('daily content') || 
              lower.includes('financial post') ||
              lower.includes('account settings')
          )) continue;

          // 5. FILTER GENERIC JUNK
          if (trimmed.length < 50) continue; 
          if (trimmed.includes('$1')) continue; 
          if (trimmed.startsWith('=')) continue;
          if (trimmed.startsWith('-')) continue;
          if (lower.includes('read also')) continue;
          if (lower.includes('click here')) continue;
          if (trimmed.includes('appeared first on')) continue;
          if (trimmed.includes('http')) continue; 
          if (trimmed.startsWith('By:') && trimmed.includes('Posted:')) continue;

          // 6. TITLE DEDUPLICATION
          const normLine = lower.replace(/[^a-z0-9]/g, '');
          if (normLine.includes(normTitle) || normTitle.includes(normLine)) {
             if (trimmed.length < currentTitle.length + 50) continue;
          }
          
          // 🟢 REPEATED INTRO CHECK
          if (i === 0 && lower.includes(article.description?.toLowerCase().slice(0, 20) || "xyz")) continue;

          // 7. MARKDOWN CLEANUP
          trimmed = trimmed
            .replace(/\!\[.*?\]\(.*?\)/g, '')   
            .replace(/\[.*?\]\(.*?\)/g, '$1')   
            .replace(/(\*\*|__)(.*?)\1/g, '$2') 
            .replace(/^#+\s/gm, '');            

          // 8. DEDUPLICATE
          if (uniqueLines.has(trimmed)) continue;
          
          uniqueLines.add(trimmed);
          cleanLines.push(trimmed);
      }

      return cleanLines;
  };

  // --- SHARE FUNCTION ---
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: article.description,
          url: article.url,
        });
      } catch (err) {
        console.log("Share canceled");
      }
    } else {
      navigator.clipboard.writeText(article.url || "");
      alert("Link copied to clipboard! 📋");
    }
  };

  useEffect(() => {
    if (hasFetched.current) return;
    if (!article.url) {
        setFullText(["No URL available."]);
        setIsLoading(false);
        return;
    }

    hasFetched.current = true; 
    setIsLoading(true);

    const fetchArticle = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await fetch(`${API_URL}/news/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: article.url })
        });

        const data = await response.json();
        const cleanParagraphs = cleanJinaOutput(data.content, article.title);
        
        if (cleanParagraphs.length === 0) {
            setFullText([article.description || "Content unavailable."]);
        } else {
            setFullText(cleanParagraphs);
        }

      } catch (e) {
        console.error("Failed to load article", e);
        setFullText([article.description || "Failed to load content."]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchArticle();
  }, [article.url]);

  const visibleText = isExpanded ? fullText : fullText.slice(0, 5);

    // Allow scrolling while the cursor is over the fixed chat bar
    useEffect(() => {
        const el = chatBarRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            window.scrollBy({ top: e.deltaY });
        };
        const onTouchStart = (e: TouchEvent) => {
           // touch logic (simplified for brevity)
        };
        const onTouchMove = (e: TouchEvent) => {
            // touch logic
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('wheel', onWheel as any);
        };
    }, []);

    return (
        <div className="nc-main">
            <div className="nc-article-container">
            <button 
                className="nc-back-btn" 
                onClick={() => navigate(-1)}
                style={{ position: 'relative', zIndex: 1000 }}
            >
                <ChevronLeft size={20} color="#FF951C" /> 
                <span>Back to Feed</span>
            </button>

            <header className="nc-header">
                <h1 className="nc-headline">{article.title}</h1>
                <div className="nc-meta-row">
                    <span className="nc-time">{releasedLabel}</span>
                    
                    <a 
                        href={article.url} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="nc-sources-pill"
                        style={{ textDecoration: 'none', cursor: 'pointer' }}
                    >
                        {favicon ? (
                            <img 
                                src={favicon} 
                                alt={sourceName} 
                                style={{ 
                                    width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' 
                                }} 
                            />
                        ) : (
                            <div className="nc-avatars">
                                <img src={`https://api.dicebear.com/7.x/initials/svg?seed=${sourceName}`} alt="" />
                            </div>
                        )}
                        <span style={{ textTransform: 'capitalize' }}>{sourceName}</span>
                        <span style={{ opacity: 0.5, fontSize: '12px' }}>↗</span>
                    </a>

                    <div className="nc-actions">
                         <button className="nc-icon-btn"><Heart size={20} /></button>
                         <button className="nc-icon-btn" onClick={handleShare}>
                             <Share2 size={20} />
                         </button>
                    </div>
                </div>
            </header>

            <article className="nc-body">
                <p className="nc-summary">
                    {article.description}
                </p>

                {/* 🟢 HERO IMAGE MOVED HERE */}
                {article.imageUrl && (
                    <div className="nc-hero-image-wrapper" style={{ marginBottom: '40px' }}>
                        <img src={article.imageUrl} alt="Article Hero" className="nc-hero-image" />
                    </div>
                )}

                <div className="nc-extended-content">
                    {isLoading ? (
                         // 🦴 SKELETON LOADER
                         <div style={{ marginTop: '20px' }}>
                            <div className="nc-skeleton-line" style={{ width: '100%' }}></div>
                            <div className="nc-skeleton-line" style={{ width: '90%' }}></div>
                            <div className="nc-skeleton-line" style={{ width: '95%' }}></div>
                            <div className="nc-skeleton-line" style={{ width: '80%', marginBottom: '40px' }}></div>
                            
                            <div className="nc-skeleton-line" style={{ width: '100%' }}></div>
                            <div className="nc-skeleton-line" style={{ width: '85%' }}></div>
                            <div className="nc-skeleton-line" style={{ width: '90%' }}></div>
                         </div>
                    ) : (
                        <>
                            {/* 🌫️ FADE EFFECT CONTAINER */}
                            <div className={!isExpanded && fullText.length > 5 ? "nc-fade-overlay" : ""}>
                                {visibleText.map((paragraph, index) => (
                                    <p key={index}>
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                            
                            {fullText.length > 5 && (
                                <button 
                                    onClick={() => setIsExpanded(!isExpanded)}
                                    style={{
                                        background: 'transparent',
                                        border: '1px solid #FF951C',
                                        color: '#FF951C',
                                        padding: '10px 20px',
                                        borderRadius: '20px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        margin: '20px auto 0',
                                        fontSize: '14px'
                                    }}
                                >
                                    {isExpanded ? (
                                        <>Show Less <ChevronUp size={16}/></>
                                    ) : (
                                        <>Read Full Article <ChevronDown size={16}/></>
                                    )}
                                </button>
                            )}
                        </>
                    )}

                    {!isLoading && (
                        <div style={{ marginTop: '40px', borderTop: '1px solid #333', paddingTop: '20px' }}>
                             <a href={article.url} target="_blank" rel="noreferrer" style={{ color: '#FF951C', textDecoration: 'none', fontSize: '16px' }}>
                                 Read original article at {sourceName} ↗
                             </a>
                        </div>
                    )}
                </div>
                
                {/* 🔴 REMOVED OLD IMAGE LOCATION FROM HERE */}
            </article>
            <div className="nc-chat-wrapper">
                <div className="nc-chat-bar" ref={chatBarRef}>
                    <div className="nc-chat-input-group">
                        <span className="nc-paperclip-icon">📎</span>
                        <input 
                            type="text" 
                            placeholder="Enter any follow up questions regarding this news..." 
                            className="nc-chat-input"
                        />
                    </div>
                    <div className="nc-chat-actions">
                        <button className="nc-chat-icon"><Mic size={18} /></button>
                        <button className="nc-chat-icon"><Puzzle size={18} /></button>
                        <button className="nc-send-btn"><Send size={16} fill="currentColor" /></button>
                    </div>
                </div>
            </div>
      </div>
    </div>
  );
};

export default NewsContent;
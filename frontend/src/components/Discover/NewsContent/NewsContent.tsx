import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Heart, Share2, Mic, Puzzle, Send, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import './NewsContent.css';

// 🟢 1. Define Props Interface
interface NewsContentProps {
  sidebarOpen: boolean; // Received from RegisteredMain
}

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

// 🟢 2. Accept sidebarOpen as a Prop
const NewsContent: React.FC<NewsContentProps> = ({ sidebarOpen }) => {
  const navigate = useNavigate();
  const { state } = useLocation();
  
  // Note: We do NOT use useOutletContext here anymore because 
  // this component is rendered directly in RegisteredMain.

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

 // --- 🔴 REFINED CLEANER (Fixes Spectrum News artifacts, $1 bugs, & Navigation junk) ---
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
          return []; 
      }

      for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i];
          let trimmed = line.trim();
          let lower = trimmed.toLowerCase();

          // --- 🚫 2.1 SPECIFIC FIXES FOR SPECTRUM NEWS / $1 ARTIFACTS ---
          
          // Remove lines starting with $1 or specific pipe formats like "$1|January 15..."
          if (/^(\$1)+/.test(trimmed)) continue; 
          if (trimmed.startsWith('$1|')) continue; 
          
          // Remove Navigation & App Prompts
          if (lower.includes('open in our app')) continue;
          if (lower.includes('toggle navigation')) continue;
          if (lower.includes('set weather location')) continue;
          if (lower.includes('confirm your location')) continue;
          if (lower.includes('enter a valid zipcode')) continue;
          if (lower.includes('choose news source')) continue;
          if (lower.includes('change location')) continue;
          if (trimmed === 'English' || trimmed === 'Español') continue;

          // Remove Video Player & Gallery Controls
          if (lower.includes('play_arrow') || lower.includes('volume_up')) continue;
          if (lower.includes('arrow_back') || lower.includes('fullscreen')) continue;
          if (lower.includes('captions off') || lower.includes('playback speed')) continue;
          if (lower.includes('picture-in-picture')) continue;
          if (lower.includes('resolution') && lower.includes('auto')) continue;

          // Remove "Read More" / "You May Also Like" lists
          if (lower.includes('you may also be interested in')) continue;
          if (lower.includes("here's what you need to know")) continue;
          if (lower.includes("here's a wrap-up")) continue;

          // --- 🚫 2.2 STANDARD FILTERS ---
          if (lower.includes("browser doesn't support push notifications")) continue;
          if (lower.includes("manage your notification settings")) continue;
          if (lower.includes('subscribe now')) continue;
          if (lower.includes('sign in to continue')) continue;
          if (lower.includes("privacy policy")) continue;
          if (lower.includes("terms of service")) continue;
          
          // Clean standard "Read More" and duplicate titles
          if (lower.includes('read more') && lower.includes(normTitle)) continue; 
          if (lower.includes('ofread more')) continue; 
          if (trimmed.startsWith('* ') && lower.includes('daily content')) continue;

          // Remove generic headers/footers
          if (trimmed.startsWith('BY ') || trimmed.startsWith('PUBLISHED ')) continue;
          if (trimmed.includes('©') && trimmed.includes('rights reserved')) continue;
          if (trimmed.includes('----')) continue; 

          // Filter very short/empty junk (e.g. "Rochester", "3:15")
          if (trimmed.length < 50 && !trimmed.endsWith('.')) {
              // Only allow short lines if they look like real sentences
              if (!trimmed.includes(' ')) continue; 
              // Filter timestamps like "3:15" or "Rochester 2 days ago"
              if (/\d+:\d+/.test(trimmed)) continue; 
              if (lower.includes('ago')) continue;
          }
          
          // --- 🛠️ 3. CLEANING INSIDE THE LINE ---
          
          // Remove the specific "$1" artifact from within text (e.g. "according to the $1.")
          trimmed = trimmed.replace(/\$1/g, ''); 

          // Standard markdown cleanup
          trimmed = trimmed
            .replace(/\!\[.*?\]\(.*?\)/g, '')   
            .replace(/\[.*?\]\(.*?\)/g, '$1')   
            .replace(/(\*\*|__)(.*?)\1/g, '$2') 
            .replace(/^#+\s/gm, '');            

          // 4. DEDUPLICATE & SAVE
          if (uniqueLines.has(trimmed)) continue;
          if (trimmed.length < 10) continue; // Skip tiny remnants

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

    useEffect(() => {
        const el = chatBarRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            window.scrollBy({ top: e.deltaY });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('wheel', onWheel as any);
        };
    }, []);

    return (
        // 🟢 3. APPLY CLASS: If sidebarOpen prop is false, add 'nc-sidebar-closed'
        <div className={`nc-main ${!sidebarOpen ? 'nc-sidebar-closed' : ''}`}>
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

                {article.imageUrl && (
                    <div className="nc-hero-image-wrapper" style={{ marginBottom: '40px' }}>
                        <img src={article.imageUrl} alt="Article Hero" className="nc-hero-image" />
                    </div>
                )}

                <div className="nc-extended-content">
                    {isLoading ? (
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
import { supabase } from '../supabaseClient'; 

// 1. Define the valid keys
export type UiCategory = 
  | 'Trending' 
  | 'Technology' 
  | 'Science'
  | 'Gaming' 
  | 'Finance & Business'
  | 'History & World Events' 
  | 'Sports' 
  | 'Cooking & Food' 
  | 'Geography & Travel'
  | 'Breaking'
  | 'Domains'; 

export interface NewsArticle {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  publishedAt?: string;
  category?: string;
  source?: string;
  url?: string;
  // 🟢 NEW: Added this so the UI can render the source stack
  all_sources?: { 
      title: string; 
      url: string; 
      source: string; 
      domain_url?: string; 
      description?: string; // <--- ADD THIS
  }[];
}

// Types for the AI Synthesis Response
export interface SynthesisResponse {
    content: string;
    sources: {
      title: string;
      url: string;
      source: string;
      citation_index: number;
    }[];
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// 🟢 FETCH FEED (List View)
export async function fetchNews(uiCategory: string = 'Trending', country: string = ''): Promise<NewsArticle[]> {
  // Map UI labels to simple keys so the backend's "Optimizer" can handle them
  let apiCategory = uiCategory.toLowerCase();
  
  if (uiCategory === 'Trending') apiCategory = 'trending'; // Let backend expand this
  if (uiCategory === 'Finance & Business') apiCategory = 'business';
  if (uiCategory === 'History & World Events') apiCategory = 'world';
  if (uiCategory === 'Cooking & Food') apiCategory = 'food';
  if (uiCategory === 'Geography & Travel') apiCategory = 'travel';
  
  console.log(`📡 FRONTEND: Asking Backend for '${apiCategory}' (Country: ${country || 'Global'})...`);

  try {
    let url = `${API_BASE_URL}/news/refresh?category=${encodeURIComponent(apiCategory)}`;
    if (country) {
        url += `&country=${country}`;
    }

    const response = await fetch(url, { method: 'POST' });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`✅ FRONTEND: Backend returned ${data.length} articles.`);
    return data;

  } catch (error) {
    console.error("❌ API Call Failed:", error);
    
    // Fallback: Try Supabase Cache
    console.log("⚠️ Backend dead? Trying to read offline cache from Supabase...");
    
    // 🟢 FIX: Match the Backend's naming convention ("AI_FEED_...")
    const cacheKey = country 
        ? `AI_FEED_${apiCategory}_${country}` 
        : `AI_FEED_${apiCategory}`;

    const { data: cache } = await supabase
      .from('news_cache')
      .select('data')
      .eq('category', cacheKey)
      .maybeSingle();

    return (cache?.data as NewsArticle[]) || [];
  }
}

// 🟢 UPDATE THIS FUNCTION
export async function synthesizeStory(topic: string, providedSources?: any[]): Promise<SynthesisResponse> {
  try {
    const bodyPayload: any = { query: topic };

    // 🟢 If we have sources, send them to the backend
    if (providedSources && providedSources.length > 0) {
      console.log(`📦 Sending ${providedSources.length} existing sources to backend...`);
      bodyPayload.sources = providedSources.map(s => ({
        title: s.title,
        url: s.url,
        source: s.source,
        snippet: s.description || ""  // Ensure we send the snippet or empty string
      }));
    }

    const response = await fetch(`${API_BASE_URL}/news/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) throw new Error('Failed to synthesize story');
    return await response.json();
  } catch (error) {
    console.error("Synthesis Error:", error);
    return { 
      content: "Sorry, I couldn't generate a report at this time. Please try again later.", 
      sources: [] 
    };
  }
}
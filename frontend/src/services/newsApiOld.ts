import { supabase } from '../supabaseClient'; 

// 1. Define the valid keys
export type UiCategory = 
  | 'Trending' 
  | 'Technology' 
  | 'Science'
  | 'Gaming' // 🟢 NEW 
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
}

// 2. The Translation Map
const CATEGORY_MAP: Record<string, string> = {
  'Trending': 'top',
  'Technology': 'technology',
  'Science': 'science',
  'Gaming': 'gaming', // 🟢 NEW (Will be trapped by backend)
  'History & World Events': 'world',
  'Sports': 'sports',
  'Cooking & Food': 'food',
  'Geography & Travel': 'tourism',
  'Entertainment': 'entertainment',
  'Education': 'education',
  'Breaking': 'top',
  'Domains': 'top' 
};

// Ensure this matches your FastAPI URL (check trailing slash if needed)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// 🟢 UPDATE: Added 'country' parameter (defaults to empty string for Global)
export async function fetchNews(uiCategory: string = 'Trending', country: string = ''): Promise<NewsArticle[]> {
  const apiCategory = CATEGORY_MAP[uiCategory] || 'top';
  
  console.log(`📡 FRONTEND: Asking Backend for '${apiCategory}' (Country: ${country || 'Global'})...`);

  try {
    // --- SIMPLE ARCHITECTURE ---
    // We do NOT check Supabase here. We ask the Backend.
    // The Backend will check the DB, check the 60-min timer, 
    // and return either Cached Data or Fresh Data.
    
    // 🟢 UPDATE: Construct URL with optional country parameter
    let url = `${API_BASE_URL}/news/refresh?category=${apiCategory}`;
    if (country) {
        url += `&country=${country}`;
    }

    const response = await fetch(url, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    // The Backend returns the list of articles directly (JSON)
    const data = await response.json();
    
    console.log(`✅ FRONTEND: Backend returned ${data.length} articles.`);
    return data;

  } catch (error) {
    console.error("❌ API Call Failed:", error);
    
    // --- FALLBACK (Optional) ---
    // If Backend is completely dead, TRY to read old cache from Supabase manually
    console.log("⚠️ Backend dead? Trying to read offline cache from Supabase...");
    
    // 🟢 UPDATE: Construct the correct cache key for fallback logic
    // If country is present, key is 'technology_us', otherwise just 'technology'
    const cacheKey = country ? `${apiCategory}_${country}` : apiCategory;

    const { data: cache } = await supabase
      .from('news_cache')
      .select('data')
      .eq('category', cacheKey)
      .maybeSingle();

    return (cache?.data as NewsArticle[]) || [];
  }
}
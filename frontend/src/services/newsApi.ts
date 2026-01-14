import { supabase } from '../supabaseClient'; 

// 1. Define the valid keys
export type UiCategory = 
  | 'Trending' 
  | 'Technology' 
  | 'Science' 
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
  'History & World Events': 'world',
  'Sports': 'sports',
  'Cooking & Food': 'food',
  'Geography & Travel': 'tourism',
  'Breaking': 'top',
  'Domains': 'top' 
};

// Ensure this matches your FastAPI URL (check trailing slash if needed)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchNews(uiCategory: string = 'Trending'): Promise<NewsArticle[]> {
  const apiCategory = CATEGORY_MAP[uiCategory] || 'top';
  
  console.log(`📡 FRONTEND: Asking Backend for '${apiCategory}'...`);

  try {
    // --- SIMPLE ARCHITECTURE ---
    // We do NOT check Supabase here. We ask the Backend.
    // The Backend will check the DB, check the 60-min timer, 
    // and return either Cached Data or Fresh Data.
    const response = await fetch(`${API_BASE_URL}/news/refresh?category=${apiCategory}`, {
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
    const { data: cache } = await supabase
      .from('news_cache')
      .select('data')
      .eq('category', apiCategory)
      .maybeSingle();

    return (cache?.data as NewsArticle[]) || [];
  }
}
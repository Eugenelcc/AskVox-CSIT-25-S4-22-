export interface SourceItem {
  title: string;
  url: string;
  snippet?: string | null;
  icon_url?: string | null;
}

export interface ImageItem {
  url: string;
  storage_path?: string | null;
  alt?: string | null;
  source_url?: string | null;
}

export interface YouTubeItem {
  title: string;
  url: string;
  video_id: string;
  channel?: string | null;
  thumbnail_url?: string | null;
}

export interface AssistantMeta {
  answer_markdown: string;
  sources: SourceItem[];
  images: ImageItem[];
  youtube: YouTubeItem[];
}


// You can also add your User profile type here later
// Add this to your existing types file
export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
}


export type ChatSenderId = string | number;

export interface ChatMessage {
  id: string | number;
  senderId: ChatSenderId;
  content: string;
  createdAt: string;
  displayName?: string;
  meta?: AssistantMeta | null;
}

// 2. Your Database Types (Used by Dashboard to parse Supabase data)
export interface DatabaseMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  created_at: string;
  user_id: string;
  display_name?: string; 
  meta?: AssistantMeta | null;
  
}
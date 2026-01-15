



// Define it once here, use it everywhere
export interface DatabaseMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  created_at: string;
  user_id: string;
}

// You can also add your User profile type here later
// Add this to your existing types file
export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  wake_word?: string | null;
}


export type ChatSenderId = string | number;

export interface ChatMessage {
  id: string | number;
  senderId: ChatSenderId;
  content: string;
  createdAt: string;
  displayName?: string;
}

// 2. Your Database Types (Used by Dashboard to parse Supabase data)
export interface DatabaseMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  created_at: string;
  user_id: string;
  display_name?: string; // Optional field for display name
  
}
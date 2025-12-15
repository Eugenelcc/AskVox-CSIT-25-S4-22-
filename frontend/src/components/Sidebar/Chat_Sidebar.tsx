import React from 'react';

interface ChatSession {
  id: string;
  title: string;
}

interface SidebarProps {
  sessions: ChatSession[];
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void; 
  isOpen: boolean; 
}

export default function Sidebar({ sessions, activeId, onSelectSession, onNewChat, onClose, isOpen }: SidebarProps) {
  return (
    <div style={{
      width: '260px',
      height: '100vh',
      background: '#000', 
      borderRight: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px',
      position: 'fixed',
      left: '80px', // Sits next to NavRail
      top: 0,
      zIndex: 90, // On top of main content
      transform: isOpen ? 'translateX(0)' : 'translateX(-100%)', 
      transition: 'transform 0.3s ease',
      boxShadow: isOpen ? '5px 0 15px rgba(0,0,0,0.5)' : 'none'
    }}>
      
      {/* --- HEADER: Title + Close Button --- */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        marginBottom: '20px',
        color: '#ff8c28',
        fontWeight: 'bold',
        fontSize: '18px'
      }}>
        <span>Chats</span>
        
        {/* ✅ CHANGED: Replaced X with a "Collapse Sidebar" Icon */}
        <button 
          onClick={onClose}
          title="Close Sidebar"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            padding: '8px', // Slightly larger hit area
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
        >
          {/* Collapse Icon (Square with arrow pointing left) */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
            <path d="m15 9-3 3 3 3"></path>
          </svg>
        </button>
      </div>

      {/* --- New Chat Button --- */}
      <button 
        onClick={onNewChat}
        style={{
          padding: '12px',
          background: 'transparent',
          border: '1px dashed #555',
          borderRadius: '8px',
          color: 'white',
          cursor: 'pointer',
          marginBottom: '20px',
          textAlign: 'left',
          transition: 'all 0.2s',
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#ff8c28'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#555'}
      >
        <span style={{ fontSize: '18px', fontWeight: 'bold' }}>+</span> 
        New Chat
      </button>

      {/* --- Session List --- */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <h4 style={{ color: '#666', fontSize: '12px', marginBottom: '10px', textTransform: 'uppercase' }}>Your Chats</h4>
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            style={{
              padding: '10px',
              borderRadius: '6px',
              cursor: 'pointer',
              color: activeId === session.id ? '#fff' : '#aaa',
              background: activeId === session.id ? '#1a1a1a' : 'transparent',
              marginBottom: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '14px',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => {
              if (activeId !== session.id) e.currentTarget.style.background = '#0f0f0f';
            }}
            onMouseLeave={(e) => {
              if (activeId !== session.id) e.currentTarget.style.background = 'transparent';
            }}
          >
            {session.title}
          </div>
        ))}
      </div>
    </div>
  );
}
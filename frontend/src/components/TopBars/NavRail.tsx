// src/components/TopBars/NavRail.tsx
//import { Link } from 'react-router-dom';

interface NavRailProps {
  activeTab: string;
  onTabClick: (tab: string) => void;
}

export default function NavRail({ activeTab, onTabClick }: NavRailProps) {
  const iconStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    cursor: 'pointer',
    marginBottom: '30px',
    color: '#888',
    textDecoration: 'none',
    transition: 'color 0.2s'
  };

  const activeStyle = { color: '#ff8c28' }; // Orange when active

  return (
    <div style={{
      width: '80px', // Fixed thin width
      height: '100vh',
      background: '#0a0a0a', // Slightly darker than main
      borderRight: '1px solid #222',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: '20px',
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 100 // Highest priority
    }}>
      {/* --- LOGO --- */}
      <div style={{ marginBottom: '40px', fontWeight: 'bold', color: '#ff8c28' }}>
        AV
      </div>

      {/* --- CHATS TAB (Toggles Sidebar) --- */}
      <div 
        style={{ ...iconStyle, ...(activeTab === 'chats' ? activeStyle : {}) }}
        onClick={() => onTabClick('chats')}
      >
        {/* Chat Bubble Icon */}
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <span style={{ fontSize: '10px', marginTop: '5px' }}>Chats</span>
      </div>

      {/* --- DISCOVER TAB (Redirects or switches view) --- */}
      <div 
        style={{ ...iconStyle, ...(activeTab === 'discover' ? activeStyle : {}) }}
        onClick={() => onTabClick('discover')}
      >
        {/* Globe Icon */}
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        <span style={{ fontSize: '10px', marginTop: '5px' }}>Discover</span>
      </div>

      {/* --- SMART REC TAB --- */}
      <div 
        style={{ ...iconStyle, ...(activeTab === 'smartrec' ? activeStyle : {}) }}
        onClick={() => onTabClick('smartrec')}
      >
        {/* Book Icon */}
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span style={{ fontSize: '10px', marginTop: '5px' }}>SmartRec</span>
      </div>
      
      {/* --- SETTINGS (Bottom) --- */}
      <div style={{ marginTop: 'auto', marginBottom: '20px', color: '#555', cursor: 'pointer' }}>
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </div>
    </div>
  );
}
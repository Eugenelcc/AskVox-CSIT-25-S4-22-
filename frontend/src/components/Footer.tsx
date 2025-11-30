import React from 'react'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div style={{fontWeight:700, color:'#fff'}}>AskVox</div>
        <div className="muted">© {new Date().getFullYear()} AskVox — All rights reserved</div>
      </div>
    </footer>
  )
}

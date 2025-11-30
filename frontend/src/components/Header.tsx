import React from 'react'

export default function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="brand">
          <span className="logo-mark" aria-hidden>
            AV
          </span>
          <span className="brand-text">AskVox</span>
        </div>

        <nav className="main-nav" aria-label="Primary">
          <a href="#platform">Platform</a>
          <a href="#services">Services</a>
          <a href="#solutions">Solutions</a>
          <a href="#creators">Creators</a>
        </nav>

        <div className="header-cta">
          <a className="btn btn-ghost" href="#get-started">Get started</a>
        </div>
      </div>
    </header>
  )
}

// home.tsx
export default function Home() {

  return (
    <main>
      <section className="hero">
        <div className="container hero-inner">
          <h1 className="hero-title">
            <span className="accent">AskVox</span>
            <span className="subtitle">AI Learning Assistant</span>
          </h1>

          <p className="hero-lead">
            Our technology — the first advanced learning AI assistant platform.
          </p>

          <div className="hero-actions">
            <a className="btn btn-primary" href="#get-started">
              Get started
            </a>
          </div>
        </div>

        <div className="hero-wire-wrapper" aria-hidden={true}>
          <svg
            className="hero-wire"
            viewBox="0 0 1600 900"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="lineGradient" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#ffb347" />
                <stop offset="1" stopColor="#ff6a00" />
              </linearGradient>
            </defs>

            {Array.from({ length: 26 }).map((_, i) => {
              const lines = 26
              const t = i / (lines - 1) // 0 (far) -> 1 (close)

              // perspective: small spacing at top, big spacing at bottom
              const y = 230 + Math.pow(t, 2) * 520

              // wave size grows as it comes closer to the camera
              const amplitude = 80 + t * 420

              // “camera” in the middle
              const cx = 800

              // perspective: further lines are narrower, closer ones wider
              const scale = 0.45 + t * 0.75

              // Stretch the very back lines so they don't leave gaps at the edges.
              // `backStretch` is how much extra span (as a fraction) to add at t=0.
              const baseSpan = 900
              const backStretch = 0.65
              const spanMultiplier = 1 + backStretch * (1 - Math.pow(t, 1.6))
              const startX = cx - baseSpan * scale * spanMultiplier
              const endX = cx + baseSpan * scale * spanMultiplier

              // Slightly widen control points for distant lines to keep curvature natural
              const baseCp = 320
              const cpMultiplier = 1 + 0.4 * (1 - t)
              const cp1x = cx - baseCp * scale * cpMultiplier
              const cp2x = cx + baseCp * scale * cpMultiplier
              const cp1y = y - amplitude
              const cp2y = y + amplitude

              // closer = thicker + brighter
              const strokeWidth = 0.7 + t * 1.5
              const opacity = 0.35 + t * 0.55

              return (
                <path
                  key={i}
                  className="hero-wire-line"
                  d={`M ${startX} ${y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${y}`}
                  stroke="url(#lineGradient)"
                  fill="none"
                  style={{
                    strokeWidth,
                    opacity,
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              )
            })}
          </svg>
        </div>
      </section>

      <section className="container features" id="platform">
        <h2>Features</h2>
        <p className="muted center">Short pitch about features and benefits.</p>

        <div className="grid">
          <div className="card">
            <h3>Personalized Learning</h3>
            <p className="muted">Adaptive lessons tailored to each student.</p>
          </div>
          <div className="card">
            <h3>Interactive Quizzes</h3>
            <p className="muted">Instant feedback and progress tracking.</p>
          </div>
          <div className="card">
            <h3>Creator Tools</h3>
            <p className="muted">Build and share interactive content.</p>
          </div>
        </div>
      </section>
    </main>
  )
}

export default function Loading() {
  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "2.5rem 1.5rem" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ width: 80, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 10 }} />
          <div style={{ width: 200, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
        </div>
        <div style={{ height: 1, background: "var(--border)", marginBottom: "2rem" }} />
        <div className="card" style={{ animation: "shimmer 1.5s ease-in-out infinite" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{
              height: 52,
              background: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
              borderBottom: "1px solid var(--border)",
              borderRadius: i === 0 ? "12px 12px 0 0" : 0,
            }} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

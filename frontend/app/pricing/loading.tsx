export default function Loading() {
  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "2.5rem 1.5rem" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ width: 80, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 10 }} />
          <div style={{ width: 240, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
        </div>
        <div style={{ height: 1, background: "var(--border)", marginBottom: "2rem" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 320, animation: "shimmer 1.5s ease-in-out infinite" }}>
              <div style={{ height: 2, background: "linear-gradient(90deg, rgba(37,99,235,0.4), transparent)" }} />
            </div>
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

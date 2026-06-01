"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Sparkles } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat with ARIA" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--bg-nav)",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "0 1.5rem",
          height: 60,
          display: "flex",
          alignItems: "center",
          gap: "2rem",
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg, #92400e, #d97706, #f59e0b)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 14px rgba(245,158,11,0.45)",
            }}
          >
            <Bot size={17} color="white" />
          </div>
          <span
            style={{
              fontWeight: 700,
              fontSize: "1rem",
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            ARIA{" "}
            <span style={{ color: "var(--accent-gold)", fontWeight: 400 }}>Real Estate</span>
          </span>
        </Link>

        {/* Nav links */}
        <div style={{ display: "flex", gap: "0.25rem", marginLeft: "auto", alignItems: "center" }}>
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            const isChat = link.href === "/chat";
            if (isChat) {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0.45rem 1.1rem",
                    borderRadius: 8,
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: "#fff",
                    background: active
                      ? "linear-gradient(135deg, #92400e, #d97706)"
                      : "linear-gradient(135deg, #1d4ed8, #2563eb)",
                    textDecoration: "none",
                    boxShadow: "0 0 14px rgba(37,99,235,0.35)",
                    transition: "all 0.2s",
                  }}
                >
                  <Sparkles size={13} />
                  Chat with ARIA
                </Link>
              );
            }
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "0.375rem 0.875rem",
                  borderRadius: 6,
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? "#fff" : "var(--text-secondary)",
                  background: active ? "rgba(37,99,235,0.15)" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s",
                  borderBottom: active ? "2px solid var(--accent-blue)" : "2px solid transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Live status */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 6px #22c55e",
              animation: "navpulse 2s infinite",
            }}
          />
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Live</span>
        </div>
      </div>

      <style>{`
        @keyframes navpulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </nav>
  );
}

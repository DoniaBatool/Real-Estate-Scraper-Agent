"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Zap, Brain, Shield, Sparkles } from "lucide-react";
import ScrapeForm from "@/components/ScrapeForm";

// ─── Feature tiles ─────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Globe,
    title: "Any Website, Any Country",
    desc: "ARIA browses real estate agency websites worldwide — Malta, Dubai, London, anywhere — using cloud AI browsers with no manual configuration.",
    accent: "#60a5fa",
    accentBg: "rgba(96,165,250,0.12)",
  },
  {
    icon: Zap,
    title: "Always Live Data",
    desc: "No stale database. Every search triggers a real browser session that scrapes live listings the moment you ask, so prices and availability are always current.",
    accent: "#f59e0b",
    accentBg: "rgba(245,158,11,0.12)",
  },
  {
    icon: Brain,
    title: "AI-Powered Understanding",
    desc: "Stagehand's AI reads any page layout using natural language — no CSS selectors, no brittle scripts. It just understands the page the way a human would.",
    accent: "#a78bfa",
    accentBg: "rgba(167,139,250,0.12)",
  },
  {
    icon: Shield,
    title: "Anti-Detection by Default",
    desc: "Browserbase cloud browsers handle fingerprinting, CAPTCHAs, and bot detection automatically. ARIA scrapes where ordinary tools get blocked.",
    accent: "#34d399",
    accentBg: "rgba(52,211,153,0.12)",
  },
] as const;

// ─── How-it-works steps ────────────────────────────────────────────────────────
const STEPS = [
  { n: "01", title: "You Ask in Plain English", desc: 'Say something like "Find 3-bedroom villas for sale in Valletta, Malta under €500k"' },
  { n: "02", title: "ARIA Discovers Agencies", desc: "Google-searches for real estate agencies in that city, picking the most relevant ones." },
  { n: "03", title: "Live Browser Scraping", desc: "Opens each agency website in a cloud browser, navigates to listings, and extracts all property data." },
  { n: "04", title: "Results Delivered Instantly", desc: "Returns formatted property cards — price, size, photos, contact info — right inside the chat." },
];

export default function HomePage() {
  const vantaRef    = useRef<HTMLDivElement>(null);
  const vantaFx     = useRef<{ destroy: () => void } | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  /* ── Vanta background ─────────────────────────────────────── */
  useEffect(() => {
    const load = async () => {
      const THREE = await import("three");
      const VANTA = (await import("vanta/dist/vanta.net.min")) as {
        default: (opts: Record<string, unknown>) => { destroy: () => void };
      };
      if (!vantaRef.current) return;
      if (vantaFx.current) vantaFx.current.destroy();
      vantaFx.current = VANTA.default({
        el: vantaRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200,
        minWidth: 200,
        scale: 1,
        color: 0x475569,
        backgroundColor: 0x070b14,
        points: 8,
        maxDistance: 18,
        spacing: 22,
      });
    };
    void load();
    return () => { vantaFx.current?.destroy(); vantaFx.current = null; };
  }, []);

  /* ── GSAP cinematic animations ────────────────────────────── */
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctx: any;

    const init = async () => {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {

        /* ── Scroll progress bar ─────────────────────── */
        gsap.to(progressRef.current, {
          scaleX: 1,
          ease: "none",
          scrollTrigger: {
            trigger: "body",
            start: "top top",
            end: "bottom bottom",
            scrub: 0.3,
          },
        });

        /* ── Hero entrance timeline ──────────────────── */
        const heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });

        heroTl.fromTo(".hero-badge",
          { y: -30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6 }
        );
        // hero-meet and aria-letter use CSS keyframes (always reliable)

        heroTl.fromTo(".hero-sub-word",
          { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.35, stagger: 0.035 },
          "-=0.3"
        );
        heroTl.fromTo(".hero-form",
          { y: 24, opacity: 0, scale: 0.97 },
          { y: 0, opacity: 1, scale: 1, duration: 0.5 },
          "-=0.2"
        );
        heroTl.fromTo(".hero-cta",
          { y: 16, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4 },
          "-=0.2"
        );
        heroTl.fromTo(".hero-scroll-hint",
          { opacity: 0 },
          { opacity: 1, duration: 0.6 },
          "-=0.1"
        );

        /* ── Ambient orbs float loop ─────────────────── */
        gsap.to(".orb-1", { y: -30, x: 20,  duration: 5, ease: "sine.inOut", yoyo: true, repeat: -1 });
        gsap.to(".orb-2", { y: 25,  x: -15, duration: 7, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1.5 });
        gsap.to(".orb-3", { y: -18, x: 25,  duration: 6, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 3 });

        /* ── "How it works" reveals ──────────────────── */
        gsap.fromTo(".hiw-label",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6,
            scrollTrigger: { trigger: ".hiw-label", start: "top 85%", once: true } }
        );
        gsap.fromTo(".hiw-title",
          { y: 40, opacity: 0, clipPath: "inset(100% 0 0 0)" },
          { y: 0, opacity: 1, clipPath: "inset(0% 0 0 0)", duration: 0.7, ease: "power3.out",
            scrollTrigger: { trigger: ".hiw-title", start: "top 85%", once: true } }
        );
        gsap.fromTo(".step-card",
          { x: -50, opacity: 0, scale: 0.95 },
          { x: 0, opacity: 1, scale: 1, duration: 0.6, stagger: 0.12, ease: "power2.out",
            scrollTrigger: { trigger: ".step-card", start: "top 80%", once: true } }
        );

        /* ── Features reveals ────────────────────────── */
        gsap.fromTo(".feat-label",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6,
            scrollTrigger: { trigger: ".feat-label", start: "top 85%", once: true } }
        );
        gsap.fromTo(".feat-title",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, delay: 0.1,
            scrollTrigger: { trigger: ".feat-title", start: "top 85%", once: true } }
        );
        gsap.fromTo(".feat-card",
          { y: 60, opacity: 0, clipPath: "inset(0 0 100% 0)" },
          { y: 0, opacity: 1, clipPath: "inset(0 0 0% 0)", duration: 0.65, stagger: 0.1, ease: "power3.out",
            scrollTrigger: { trigger: ".feat-card", start: "top 80%", once: true } }
        );

        /* ── Tech badges pop in ───────────────────────── */
        gsap.fromTo(".tech-badge",
          { y: 20, opacity: 0, scale: 0.85 },
          { y: 0, opacity: 1, scale: 1, duration: 0.4, stagger: 0.06, ease: "back.out(1.4)",
            scrollTrigger: { trigger: ".tech-badge", start: "top 90%", once: true } }
        );

        /* ── CTA entrance ────────────────────────────── */
        gsap.fromTo(".cta-icon",
          { scale: 0, rotation: -180, opacity: 0 },
          { scale: 1, rotation: 0, opacity: 1, duration: 0.7, ease: "elastic.out(1, 0.5)",
            scrollTrigger: { trigger: ".cta-icon", start: "top 85%", once: true } }
        );
        gsap.fromTo(".cta-text",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6,
            scrollTrigger: { trigger: ".cta-text", start: "top 85%", once: true } }
        );
        gsap.fromTo(".cta-btn",
          { scale: 0.85, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.5)",
            scrollTrigger: { trigger: ".cta-btn", start: "top 90%", once: true } }
        );

      });
    };

    void init();
    return () => { ctx?.revert(); };
  }, []);

  /* ── 3D magnetic tilt on cards ────────────────────────────── */
  const onCardMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width  / 2)) / (r.width  / 2);
    const dy = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2);
    c.style.transform = `perspective(700px) rotateY(${dx * 9}deg) rotateX(${-dy * 9}deg) scale(1.03)`;
    c.style.transition = "transform 0.08s ease";
  };
  const onCardLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = "perspective(700px) rotateY(0) rotateX(0) scale(1)";
    e.currentTarget.style.transition = "transform 0.55s ease";
  };

  /* ── Subtitle word-split ──────────────────────────────────── */
  const subtitleWords =
    "Tell ARIA what you're looking for. She opens real agency websites worldwide, browses listings in real-time, and brings you the exact properties — with prices, photos, and contact details — in seconds."
      .split(" ");

  return (
    <div className="relative min-h-screen bg-[#070b14]">

      {/* ── Scroll progress bar ──────────────────────────── */}
      <div
        ref={progressRef}
        className="fixed top-0 left-0 z-[100] h-[2px] w-full origin-left bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500"
        style={{ transform: "scaleX(0)" }}
      />

      {/* ────────────────────── HERO ────────────────────── */}
      <section className="relative flex min-h-[calc(100vh-60px)] flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-10">

        <div ref={vantaRef} className="pointer-events-none absolute inset-0 z-0" />

        {/* Ambient orbs */}
        <div className="orb-1 pointer-events-none absolute left-[15%] top-[20%] z-[1] h-72 w-72 rounded-full bg-blue-500/10   blur-[80px]" />
        <div className="orb-2 pointer-events-none absolute right-[15%] top-[35%] z-[1] h-64 w-64 rounded-full bg-amber-500/10  blur-[80px]" />
        <div className="orb-3 pointer-events-none absolute left-[40%] bottom-[10%] z-[1] h-48 w-48 rounded-full bg-purple-500/10 blur-[80px]" />

        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-[#070b14]/80 via-[#070b14]/40 to-[#070b14]" />
        <div className="pointer-events-none absolute inset-0 z-[11] bg-[radial-gradient(ellipse_90%_60%_at_50%_30%,rgba(7,11,20,0.5),transparent)]" />

        <div className="relative z-20 mx-auto flex w-full max-w-4xl flex-col items-center text-center">

          {/* Badge */}
          <div className="hero-badge mb-8 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2" style={{ opacity: 0 }}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
            <span className="text-sm font-medium text-amber-300">
              Powered by Stagehand · Browserbase · OpenAI
            </span>
          </div>

          {/* Headline */}
          <h1 className="mb-5 text-5xl font-bold leading-tight tracking-tight md:text-7xl lg:text-8xl">
            <span
              className="hero-meet inline-block text-white"
              style={{ animation: "heroSlideIn 0.6s ease forwards", animationDelay: "0.3s", opacity: 0 }}
            >Meet</span>{" "}
            <span aria-label="ARIA">
              {"ARIA".split("").map((l, i) => (
                <span
                  key={i}
                  className="inline-block bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent"
                  style={{
                    animation: "ariaLetterIn 0.5s ease forwards",
                    animationDelay: `${0.55 + i * 0.08}s`,
                    opacity: 0,
                  }}
                >{l}</span>
              ))}
            </span>
            <br />
            <span className="text-4xl font-semibold text-white/90 md:text-5xl lg:text-6xl">
              Your AI Real Estate Agent
            </span>
          </h1>

          {/* Sub-headline — word by word */}
          <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-slate-400 md:text-xl">
            {subtitleWords.map((word, i) => (
              <span key={i} className="hero-sub-word inline-block" style={{ opacity: 0, marginRight: "0.28em" }}>
                {word}
              </span>
            ))}
          </p>

          <div className="hero-form mb-6 w-full max-w-xl" style={{ opacity: 0 }}>
            <ScrapeForm />
          </div>

          <div className="hero-cta" style={{ opacity: 0 }}>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-medium text-slate-300 backdrop-blur transition hover:border-white/30 hover:bg-white/10 hover:text-white"
            >
              <Sparkles size={14} />
              Open full chat interface
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div className="hero-scroll-hint absolute bottom-6 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-1.5" style={{ opacity: 0 }}>
          <span className="text-[11px] uppercase tracking-[0.15em] text-slate-600">How it works</span>
          <div className="h-5 w-0.5 animate-bounce rounded bg-slate-700" />
        </div>
      </section>

      {/* ────────────────── HOW IT WORKS ──────────────────── */}
      <section className="relative z-10 border-t border-white/[0.06] bg-gradient-to-b from-[#070b14] to-[#0a0f1e] px-4 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="hiw-label mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400/80" style={{ opacity: 0 }}>Process</p>
            <h2 className="hiw-title text-3xl font-bold tracking-tight text-white md:text-4xl" style={{ opacity: 0 }}>How ARIA Works</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-slate-400 md:text-base">From your question to live property data in under two minutes.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                className="step-card group relative rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur cursor-default"
                style={{ opacity: 0 }}
                onMouseMove={onCardMove}
                onMouseLeave={onCardLeave}
              >
                <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15), 0 0 30px rgba(96,165,250,0.08)" }} />
                <div className="mb-4 text-4xl font-black text-white/[0.07] transition-colors duration-300 group-hover:text-white/[0.14]">{step.n}</div>
                <h3 className="mb-2 text-base font-bold text-white">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-500">{step.desc}</p>
                {i < STEPS.length - 1 && (
                  <div className="absolute -right-3 top-1/2 hidden -translate-y-1/2 lg:block">
                    <ArrowRight size={16} className="text-slate-700" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────────── FEATURES ────────────────────── */}
      <section
        className="relative z-10 px-4 py-20 md:py-28"
        style={{ backgroundImage: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(37,99,235,0.1), transparent), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(245,158,11,0.07), transparent)" }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="feat-label mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/80" style={{ opacity: 0 }}>Capabilities</p>
            <h2 className="feat-title text-3xl font-bold tracking-tight text-white md:text-4xl" style={{ opacity: 0 }}>Built for the Real World</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-slate-400 md:text-base">Every technical decision was made to solve the actual problems with real estate data.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="feat-card group relative rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur cursor-default"
                  style={{ opacity: 0 }}
                  onMouseMove={onCardMove}
                  onMouseLeave={onCardLeave}
                >
                  <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ boxShadow: `0 0 40px ${f.accent}20, inset 0 0 0 1px ${f.accent}25` }} />
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110" style={{ background: f.accentBg }}>
                    <Icon size={20} style={{ color: f.accent }} strokeWidth={1.75} />
                  </div>
                  <h3 className="mb-2 text-base font-bold text-white">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ──────────────────── TECH STACK ──────────────────── */}
      <section className="relative z-10 border-t border-white/[0.06] px-4 py-12">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">Tech Stack</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { label: "Stagehand",         color: "#60a5fa" },
              { label: "Browserbase",       color: "#34d399" },
              { label: "OpenAI Agents SDK", color: "#a78bfa" },
              { label: "Next.js 16",        color: "#f8fafc" },
              { label: "FastAPI",           color: "#f59e0b" },
              { label: "Supabase",          color: "#3ecf8e" },
              { label: "TypeScript",        color: "#60a5fa" },
              { label: "Python",            color: "#fbbf24" },
              { label: "GSAP",              color: "#88ce02" },
              { label: "Three.js",          color: "#ffffff" },
            ].map((tech) => (
              <span
                key={tech.label}
                className="tech-badge rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium"
                style={{ color: tech.color, opacity: 0 }}
              >
                {tech.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────── CTA ──────────────────────── */}
      <section className="relative z-10 overflow-hidden border-t border-white/[0.06] px-4 py-20 md:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(245,158,11,0.06),transparent)]" />
        <div className="relative z-10 mx-auto max-w-2xl text-center">
          <div className="cta-icon mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-400 shadow-lg shadow-amber-900/40" style={{ opacity: 0 }}>
            <Sparkles size={28} color="white" />
          </div>
          <div className="cta-text" style={{ opacity: 0 }}>
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">Ready to find your property?</h2>
            <p className="mb-8 text-base text-slate-400">Ask ARIA in plain English. She&apos;ll browse the web, find the listings, and present them beautifully.</p>
          </div>
          <Link
            href="/chat"
            className="cta-btn inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-8 py-4 text-base font-bold text-white shadow-lg shadow-amber-900/40 transition hover:from-amber-500 hover:to-yellow-400"
            style={{ opacity: 0 }}
          >
            Start Chatting with ARIA
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] px-4 py-8 text-center">
        <p className="text-xs text-slate-700">
          Built with Stagehand · Browserbase · OpenAI Agents SDK · FastAPI · Next.js · GSAP
        </p>
      </footer>
    </div>
  );
}

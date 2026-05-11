"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import {
  Boxes,
  Brain,
  Compass,
  Cpu,
  Database,
  GitCompare,
  Globe2,
  HeartHandshake,
  Layers,
  MapPin,
  Mic,
  Mic2,
  Sparkles,
  Telescope,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import { AboutAriaToneStrip } from "@/components/AboutAriaToneStrip";
import { ARIA_LIVE_ITEMS, ARIA_ROADMAP_ITEMS } from "@/data/ariaCapabilitySlides";

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

/** Slides: 0 hero, 1 stats+intel, 2 tone, 3 tools, 4 live/roadmap + CTA */
const MAX_SLIDE_INDEX = 4;

const TOOLS = [
  {
    icon: Database,
    name: "search_database",
    title: "Live database search",
    desc: "Query agencies and listings with filters — price, m², locality, beds, type — grounded in your Supabase data.",
    tone: "Precise",
  },
  {
    icon: Globe2,
    name: "web_search",
    title: "Market-aware web search",
    desc: "Tavily-backed lookup when configured; broader context for regulations, neighborhoods, and benchmarks.",
    tone: "Current",
  },
  {
    icon: Layers,
    name: "scrape_city",
    title: "City scrape orchestration",
    desc: "Starts discovery + scrape jobs so fresh agencies and listings flow into your pipeline from any city.",
    tone: "Action",
  },
  {
    icon: TrendingUp,
    name: "get_pricing_analysis",
    title: "Pricing intelligence",
    desc: "Summarizes price dynamics from your dataset — averages, ranges, and angles worth explaining to a buyer.",
    tone: "Analytical",
  },
  {
    icon: GitCompare,
    name: "compare_properties",
    title: "Property comparison",
    desc: "Structured side-by-side comparison across criteria you care about — not generic bullet fluff.",
    tone: "Decisive",
  },
  {
    icon: MapPin,
    name: "get_area_pricing",
    title: "Area & locality pricing",
    desc: "Hyper-local signals plus narrative context so “expensive” vs “fair” has substance.",
    tone: "Local",
  },
  {
    icon: Compass,
    name: "get_agency_detail",
    title: "Agency deep dive",
    desc: "Contacts, reputation signals, listings — one coherent brief per agency.",
    tone: "Trusted",
  },
];

const SLIDE_LABELS = ["Intro", "Intelligence", "Tone", "Tools", "Roadmap"];

export default function AboutAriaPage() {
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const innerScrollRefs = useRef<(HTMLDivElement | null)[]>(
    Array.from({ length: MAX_SLIDE_INDEX + 1 }, () => null),
  );
  const wheelAccumRef = useRef(0);
  const wheelAccumResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  /** Slide 2 (Tone): portraitProgress 0→1 = side → full face in place (wheel-driven on lg). */
  const [tonePortraitProgress, setTonePortraitProgress] = useState(0);
  const tonePortraitProgressRef = useRef(0);
  tonePortraitProgressRef.current = tonePortraitProgress;
  const prevSlideRef = useRef(activeSlide);

  useEffect(() => {
    const prev = prevSlideRef.current;
    prevSlideRef.current = activeSlide;

    if (activeSlide !== 2) {
      setTonePortraitProgress(0);
      const el = innerScrollRefs.current[2];
      if (el) el.scrollTop = 0;
      return;
    }
    if (prev !== 2) {
      requestAnimationFrame(() => {
        const el = innerScrollRefs.current[2];
        if (el) {
          el.scrollTop = 0;
          setTonePortraitProgress(0);
        }
      });
    }
  }, [activeSlide]);

  const syncSlideFromScroll = useCallback(() => {
    const el = sliderRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const idx = Math.round(el.scrollLeft / w);
    setActiveSlide(Math.min(MAX_SLIDE_INDEX, Math.max(0, idx)));
  }, []);

  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncSlideFromScroll);
    syncSlideFromScroll();
    return () => el.removeEventListener("scroll", syncSlideFromScroll);
  }, [syncSlideFromScroll]);

  const goToSlide = useCallback((index: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const clamped = Math.min(MAX_SLIDE_INDEX, Math.max(0, index));
    el.scrollTo({ left: clamped * w, behavior: "smooth" });
    wheelAccumRef.current = 0;
  }, []);

  const consumeInnerScroll = (el: HTMLElement | null, e: WheelEvent) => {
    if (!el) return false;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop <= 1;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 2;
    if (e.deltaY > 0 && !atBottom) return true;
    if (e.deltaY < 0 && !atTop) return true;
    return false;
  };

  useEffect(() => {
    const SCROLL_INTENT = 52;
    const TONE_STEP = 0.0028;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

      const slider = sliderRef.current;
      if (!slider) return;

      const w = slider.clientWidth || 1;
      const slideIndex = Math.round(slider.scrollLeft / w);
      const toneInner = innerScrollRefs.current[2];
      const p = tonePortraitProgressRef.current;

      if (slideIndex === 2) {
        if (e.deltaY > 0 && p < 1 - 1e-3) {
          e.preventDefault();
          e.stopPropagation();
          setTonePortraitProgress((prev) => Math.min(1, prev + Math.abs(e.deltaY) * TONE_STEP));
          return;
        }
        if (
          e.deltaY < 0 &&
          p > 1e-3 &&
          toneInner &&
          toneInner.scrollTop <= 2
        ) {
          e.preventDefault();
          e.stopPropagation();
          setTonePortraitProgress((prev) => Math.max(0, prev - Math.abs(e.deltaY) * TONE_STEP));
          return;
        }
      }

      const inner = innerScrollRefs.current[slideIndex];
      if (inner && consumeInnerScroll(inner, e)) return;

      e.preventDefault();
      e.stopPropagation();

      wheelAccumRef.current += e.deltaY;

      if (wheelAccumResetRef.current) clearTimeout(wheelAccumResetRef.current);
      wheelAccumResetRef.current = setTimeout(() => {
        wheelAccumRef.current = 0;
        wheelAccumResetRef.current = null;
      }, 220);

      if (wheelAccumRef.current >= SCROLL_INTENT) {
        wheelAccumRef.current = 0;
        if (slideIndex < MAX_SLIDE_INDEX) goToSlide(slideIndex + 1);
        return;
      }
      if (wheelAccumRef.current <= -SCROLL_INTENT) {
        wheelAccumRef.current = 0;
        if (slideIndex > 0) goToSlide(slideIndex - 1);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      if (wheelAccumResetRef.current) clearTimeout(wheelAccumResetRef.current);
    };
  }, [goToSlide]);

  const setInnerRef = (i: number) => (el: HTMLDivElement | null) => {
    innerScrollRefs.current[i] = el;
  };

  return (
    <div className="relative isolate h-[calc(100dvh-60px)] min-h-[calc(100vh-60px)] max-h-[calc(100dvh-60px)] overflow-hidden">
      {/* One viewport tall — no document scroll gap below the horizontal slides */}
      {/* Portal-like layering: strip is sibling to slider so position:fixed isn’t clipped */}
      <AboutAriaToneStrip visible={activeSlide === 2} portraitProgress={tonePortraitProgress} />

      <div
        ref={sliderRef}
        className="home-horizontal-slides flex h-full min-h-0 w-full flex-nowrap overflow-x-auto overflow-y-hidden scroll-smooth snap-x snap-mandatory overscroll-x-contain"
        style={{ scrollBehavior: "smooth" }}
      >
        {/* ——— Slide 0: Hero ——— */}
        <div className="relative flex h-full min-h-0 max-h-full w-full min-w-full shrink-0 snap-start snap-always flex-col overflow-hidden border-b border-white/[0.06]">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.35), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(226,181,90,0.12), transparent)",
            }}
          />
          <div className="relative z-10 mx-auto flex min-h-0 flex-1 flex-col justify-center px-5 pb-16 pt-12 text-center md:pb-24 md:pt-16">
            <motion.div {...fadeUp} transition={{ duration: 0.45 }} className="mb-6 inline-flex items-center gap-2 self-center rounded-full border border-amber-400/25 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/90">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              Meet ARIA
            </motion.div>
            <motion.h1
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="mb-5 text-4xl font-extrabold tracking-tight text-white md:text-5xl lg:text-6xl"
            >
              The agent that turns{" "}
              <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-amber-300 bg-clip-text text-transparent">
                scattered listings
              </span>{" "}
              into decisions
            </motion.h1>
            <motion.p
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mx-auto max-w-2xl text-lg leading-relaxed text-slate-400 md:text-xl"
            >
              ARIA is not a generic chatbot. It is a{" "}
              <strong className="font-semibold text-slate-200">real-estate intelligence layer</strong> wired to your
              database, scrapers, and optional web search — tuned to sound human, stay concise, and actually{" "}
              <em className="text-slate-300 not-italic">do</em> things: search, scrape, compare, explain.
            </motion.p>
            <motion.div
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <Link
                href="/chat"
                className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:bg-blue-500"
              >
                Open ARIA Chat
              </Link>
              <Link
                href="/pricing"
                className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-200 backdrop-blur transition hover:border-white/25 hover:bg-white/10"
              >
                See pricing intelligence
              </Link>
            </motion.div>
            <p className="mt-10 text-xs text-slate-500">
              Scroll down or swipe → next slide
            </p>
          </div>
        </div>

        {/* ——— Slide 1: Stats + Intelligence ——— */}
        <div className="flex h-full min-h-0 max-h-full w-full min-w-full shrink-0 snap-start snap-always flex-col border-b border-white/[0.06] bg-[var(--bg-base)]">
          <div
            ref={setInnerRef(1)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-5 py-10 md:py-14"
          >
            <section className="border-b border-white/[0.06] bg-[#070b14]/80 py-8">
              <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 md:grid-cols-4">
                {[
                  { n: "7+", l: "Specialized tools", i: Wrench },
                  { n: "GPT-class", l: "Reasoning + intent routing", i: Cpu },
                  { n: "Live data", l: "Your Supabase estate", i: Database },
                  { n: "Voice + 3D UI", l: "Speak or explore visually", i: Mic2 },
                ].map(({ n, l, i: Icon }, idx) => (
                  <motion.div
                    key={l}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.06 }}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center backdrop-blur-sm"
                  >
                    <Icon className="mx-auto mb-3 h-6 w-6 text-blue-400" strokeWidth={1.75} />
                    <div className="text-xl font-bold text-white md:text-2xl">{n}</div>
                    <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{l}</div>
                  </motion.div>
                ))}
              </div>
            </section>

            <section className="mx-auto max-w-5xl py-12 md:py-16">
              <div className="mb-10 text-center">
                <h2 className="text-3xl font-bold text-white md:text-4xl">How smart is ARIA?</h2>
                <p className="mx-auto mt-4 max-w-2xl text-slate-400">
                  Intelligence here means <strong className="text-slate-300">grounded answers</strong>, not confident
                  hallucinations. ARIA separates small talk from work, picks tools deliberately, and adapts tone —
                  professional warmth, not corporate jargon.
                </p>
              </div>
              <div className="grid gap-6 md:grid-cols-3">
                {[
                  {
                    icon: Brain,
                    title: "Intent routing",
                    body: "Detects whether you are chatting casually or asking for a task, so replies stay short when appropriate and go deep when needed.",
                  },
                  {
                    icon: Boxes,
                    title: "Tool orchestration",
                    body: "Chains database lookups, scrapes, comparisons, and web context — mirroring how an analyst would research.",
                  },
                  {
                    icon: Zap,
                    title: "Memory (optional)",
                    body: "With pgvector migrations applied, embeddings help ARIA recall themes across sessions — “welcome back” moments without creepiness.",
                  },
                ].map((card, i) => (
                  <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-7 shadow-xl shadow-black/20"
                  >
                    <card.icon className="mb-4 h-9 w-9 text-blue-400" strokeWidth={1.5} />
                    <h3 className="mb-2 text-lg font-bold text-white">{card.title}</h3>
                    <p className="text-sm leading-relaxed text-slate-400">{card.body}</p>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* ——— Slide 2: Personality ——— */}
        <div className="flex h-full min-h-0 max-h-full w-full min-w-full shrink-0 snap-start snap-always flex-col overflow-hidden border-b border-white/[0.06] bg-[#0a0f1a]">
          <div
            ref={setInnerRef(2)}
            onScroll={(e) => {
              if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) return;
              const el = e.currentTarget;
              const ramp = 420;
              setTonePortraitProgress(Math.min(1, Math.max(0, el.scrollTop / ramp)));
            }}
            className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-[#0a0f1a] px-5 md:px-8"
          >
            <section className="relative flex w-full shrink-0 flex-col justify-center bg-[#0a0f1a] py-10 md:py-14 lg:min-h-0 lg:py-16">
              <div className="relative z-[1] flex flex-col justify-center py-10 md:py-14 lg:py-16">
                <div className="mx-auto w-full max-w-5xl lg:pr-[min(400px,42vw)] xl:pr-[min(440px,44vw)]">
                  <div className="mb-4 inline-flex items-center gap-2 text-amber-200/90">
                    <HeartHandshake className="h-6 w-6 shrink-0" />
                    <span className="text-sm font-bold uppercase tracking-widest">Presence</span>
                  </div>
                  <h2 className="text-3xl font-bold leading-tight text-white md:text-4xl lg:text-[2.75rem]">
                    Tone & empathy
                  </h2>
                  <p className="mt-5 max-w-md text-base leading-relaxed text-slate-400 md:text-lg">
                    Real estate is emotional — budget stress, timing, family trade-offs. ARIA is written to acknowledge
                    that without melodrama: clear next steps, respectful pacing, and zero condescension.
                  </p>
                </div>
              </div>
            </section>

            <div className="relative -mx-5 aspect-[3/4] max-h-[min(520px,70vh)] min-h-[240px] w-full max-w-lg shrink-0 self-center overflow-hidden rounded-2xl bg-[#0a0f1a] md:-mx-8 lg:hidden">
              <Image
                src="/assets/blue-side.jpg"
                alt=""
                fill
                priority
                className="object-cover object-center"
                sizes="100vw"
                style={{
                  opacity: Math.min(1, Math.max(0, 1 - tonePortraitProgress)),
                }}
              />
              <Image
                src="/assets/blue-full.jpg"
                alt="ARIA"
                fill
                priority
                className="object-cover object-center"
                sizes="100vw"
                style={{
                  opacity: Math.min(1, Math.max(0, tonePortraitProgress)),
                }}
              />
            </div>

            <section className="mx-auto max-w-5xl shrink-0 px-0 py-6 md:py-8">
              <div className="mx-auto h-px max-w-md bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </section>
          </div>
        </div>

        {/* ——— Slide 3: Tools ——— */}
        <div className="flex h-full min-h-0 max-h-full w-full min-w-full shrink-0 snap-start snap-always flex-col border-b border-white/[0.06] bg-[var(--bg-base)]">
          <div
            ref={setInnerRef(3)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-5 py-10 md:py-14"
          >
            <section className="mx-auto max-w-6xl py-4 md:py-6">
              <div className="mb-10 text-center">
                <h2 className="text-3xl font-bold text-white md:text-4xl">Tools & skills</h2>
                <p className="mx-auto mt-4 max-w-2xl text-slate-400">
                  Each capability is a callable skill — not marketing jargon. Together they cover search, acquisition of
                  new data, analysis, and narrative.
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {TOOLS.map((t, i) => (
                  <motion.article
                    key={t.name}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[var(--bg-card)] p-6 transition hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-900/10"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
                        <t.icon className="h-5 w-5" strokeWidth={1.75} />
                      </div>
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {t.tone}
                      </span>
                    </div>
                    <h3 className="mb-1 text-lg font-bold text-white group-hover:text-blue-300">{t.title}</h3>
                    <code className="mb-3 block text-[11px] text-slate-500">{t.name}</code>
                    <p className="text-sm leading-relaxed text-slate-400">{t.desc}</p>
                  </motion.article>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* ——— Slide 4: Live / Roadmap + CTA ——— */}
        <div className="flex h-full min-h-0 max-h-full w-full min-w-full shrink-0 snap-start snap-always flex-col bg-[var(--bg-base)]">
          <div
            ref={setInnerRef(4)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-5 py-10 md:py-12"
          >
            <section className="mx-auto grid max-w-6xl gap-6 py-4 lg:grid-cols-2 lg:gap-8">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45 }}
                className="rounded-2xl border border-emerald-500/25 bg-emerald-950/25 p-6 shadow-xl md:p-8"
              >
                <div className="mb-5 flex items-center gap-2 text-emerald-400">
                  <Zap className="h-5 w-5 shrink-0" strokeWidth={2} />
                  <h2 className="text-lg font-bold uppercase tracking-wide">Live in product</h2>
                </div>
                <ul className="space-y-2.5 text-sm leading-snug text-slate-300 md:space-y-3">
                  {ARIA_LIVE_ITEMS.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-emerald-400">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: 0.06 }}
                className="rounded-2xl border border-amber-500/25 bg-amber-950/20 p-6 shadow-xl md:p-8"
              >
                <div className="mb-5 flex items-center gap-2 text-amber-300">
                  <Telescope className="h-5 w-5 shrink-0" strokeWidth={2} />
                  <h2 className="text-lg font-bold uppercase tracking-wide">On the horizon</h2>
                </div>
                <p className="mb-4 text-sm text-slate-400">
                  Not yet shipped — planned upgrades that will plug into the same agent architecture:
                </p>
                <ul className="space-y-2.5 text-sm leading-snug text-slate-300 md:space-y-3">
                  {ARIA_ROADMAP_ITEMS.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-amber-400/90">◆</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </section>

            <section className="mx-auto mt-8 max-w-3xl border-t border-white/[0.06] pt-10 pb-6">
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-950/50 to-slate-950/80 p-8 text-center md:p-10">
                <Mic className="mx-auto mb-4 h-10 w-10 text-blue-400" strokeWidth={1.25} />
                <h2 className="text-2xl font-bold text-white md:text-3xl">Experience ARIA</h2>
                <p className="mx-auto mt-3 max-w-lg text-slate-400">
                  Try voice on the homepage orb or the mic in chat. Use the slides on this page or visit the platform
                  cards on home — agencies, listings, and pricing.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/"
                    className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
                  >
                    Back to home
                  </Link>
                  <Link href="/chat" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">
                    Start chatting
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Slide indicators */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex max-w-[90vw] -translate-x-1/2 flex-wrap justify-center gap-1.5 md:bottom-5 md:gap-2">
        {Array.from({ length: MAX_SLIDE_INDEX + 1 }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${SLIDE_LABELS[i] ?? `Slide ${i + 1}`}`}
            onClick={() => goToSlide(i)}
            className={`pointer-events-auto h-2.5 rounded-full transition-all ${
              activeSlide === i ? "w-7 bg-blue-500 md:w-8" : "w-2.5 bg-white/25 hover:bg-white/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  ChevronLeft,
  Database,
  Search,
  TableProperties,
  TrendingUp,
} from "lucide-react";
import ScrapeForm from "@/components/ScrapeForm";
import { VoiceOrb } from "@/components/VoiceOrb";
import { getPricingData } from "@/lib/api";

const STAT_ICON_COMPACT = 24;

function StatCounter({
  value,
  label,
  icon,
  accent,
  compact = false,
}: {
  value: number;
  label: string;
  icon: ReactNode;
  accent: string;
  /** Narrow card when placed beside the voice orb */
  compact?: boolean;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (value === 0) return;
    const step = Math.max(1, Math.ceil(value / 40));
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + step, value);
      setCount(current);
      if (current >= value) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={
        compact
          ? "w-full min-w-[148px] max-w-[200px] rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-5 text-center shadow-lg shadow-black/25 backdrop-blur-md md:max-w-[220px] md:px-5"
          : "min-w-[200px] rounded-2xl border border-white/10 bg-white/[0.06] px-8 py-6 text-center shadow-lg shadow-black/20 backdrop-blur-md md:min-w-[260px]"
      }
    >
      <div className={`flex justify-center text-slate-400 ${compact ? "mb-2" : "mb-3"}`} style={{ color: accent }}>
        {icon}
      </div>
      <div
        className={`font-extrabold tabular-nums tracking-tight text-white ${
          compact ? "text-2xl md:text-3xl" : "text-3xl md:text-4xl"
        }`}
      >
        {count.toLocaleString()}
      </div>
      <div className={`font-medium uppercase tracking-wider text-slate-500 ${compact ? "mt-1.5 text-[10px] md:text-xs" : "mt-2 text-xs"}`}>
        {label}
      </div>
      <div className={`text-slate-600 ${compact ? "mt-2 text-[10px]" : "mt-3 text-[11px]"}`}>Live indexed records</div>
    </motion.div>
  );
}

const FEATURE_ITEMS = [
  {
    icon: Search,
    title: "Agency Cards",
    desc: "Browse scraped agencies with contacts, owner info, social links, and ratings.",
    href: "/agencies",
    tone: "Browse",
  },
  {
    icon: TableProperties,
    title: "Property Table",
    desc: "Sort and filter listings by price, sqm, bedrooms, locality — plus CSV export.",
    href: "/properties",
    tone: "Analyze",
  },
  {
    icon: TrendingUp,
    title: "Pricing Intelligence",
    desc: "Interactive charts — avg price per m² by locality and property-type comparison.",
    href: "/pricing",
    tone: "Charts",
  },
] as const;

function FeatureCards() {
  return (
    <div className="grid w-full max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURE_ITEMS.map((feature, i) => {
        const Icon = feature.icon;
        return (
          <motion.article
            key={feature.href}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[var(--bg-card)] p-6 transition hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-900/10"
          >
            <Link href={feature.href} className="block">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {feature.tone}
                </span>
              </div>
              <h3 className="mb-1 text-lg font-bold text-white group-hover:text-blue-300">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{feature.desc}</p>
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-400 transition group-hover:gap-3">
                Explore
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </span>
            </Link>
          </motion.article>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const vantaRef = useRef<HTMLDivElement | null>(null);
  const vantaEffect = useRef<{ destroy: () => void } | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const slide2Ref = useRef<HTMLDivElement | null>(null);
  const wheelAccumRef = useRef(0);
  const wheelAccumResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stats, setStats] = useState({ agencies: 0, properties: 0 });
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    getPricingData()
      .then((d) =>
        setStats({
          agencies: d.summary.total_agencies,
          properties: d.summary.total_properties,
        }),
      )
      .catch(() => null);
  }, []);

  useEffect(() => {
    const loadVanta = async () => {
      const THREE = await import("three");
      const VANTA = (await import("vanta/dist/vanta.net.min")) as {
        default: (opts: Record<string, unknown>) => { destroy: () => void };
      };

      if (!vantaRef.current) return;
      if (vantaEffect.current) vantaEffect.current.destroy();

      vantaEffect.current = VANTA.default({
        el: vantaRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.0,
        minWidth: 200.0,
        scale: 1.0,
        scaleMobile: 1.0,
        color: 0x475569,
        backgroundColor: 0x070b14,
        points: 8.0,
        maxDistance: 18.0,
        spacing: 22.0,
      });
    };

    void loadVanta();
    return () => {
      if (vantaEffect.current) {
        vantaEffect.current.destroy();
        vantaEffect.current = null;
      }
    };
  }, []);

  const syncSlideFromScroll = useCallback(() => {
    const el = sliderRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const idx = Math.round(el.scrollLeft / w);
    setActiveSlide(Math.min(1, Math.max(0, idx)));
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
    el.scrollTo({ left: index * w, behavior: "smooth" });
    wheelAccumRef.current = 0;
  }, []);

  /**
   * Trackpads send many small deltaY values — accumulating beats tiny scrollLeft nudges.
   * Two slides (0–1): hero → platform cards.
   */
  useEffect(() => {
    const SCROLL_INTENT = 52;
    const MAX_IDX = 1;

    const consumeInnerScroll = (el: HTMLElement | null, e: WheelEvent) => {
      if (!el) return false;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atTop = scrollTop <= 1;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 2;
      if (e.deltaY > 0 && !atBottom) return true;
      if (e.deltaY < 0 && !atTop) return true;
      return false;
    };

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

      const slider = sliderRef.current;
      if (!slider) return;

      const w = slider.clientWidth || 1;
      const slideIndex = Math.round(slider.scrollLeft / w);

      if (slideIndex === 1 && consumeInnerScroll(slide2Ref.current, e)) return;

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
        if (slideIndex < MAX_IDX) goToSlide(slideIndex + 1);
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

  return (
    <div className="relative">
      {/* Horizontal slideshow: slide 1 = hero, slide 2 = platform cards */}
      <div
        ref={sliderRef}
        className="home-horizontal-slides flex h-[calc(100vh-60px)] w-full flex-nowrap overflow-x-auto overflow-y-hidden scroll-smooth snap-x snap-mandatory overscroll-x-contain"
        style={{ scrollBehavior: "smooth" }}
      >
        {/* ——— Slide 1: Hero (full viewport below nav) ——— */}
        <div className="relative flex h-full max-h-[calc(100vh-60px)] w-full min-w-full shrink-0 snap-start snap-always flex-col overflow-hidden pb-14">
          <div ref={vantaRef} className="pointer-events-none absolute inset-0 z-0 min-h-[400px]" />

          <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-[#070b14]/80 via-[#070b14]/40 to-[#070b14]" />
          <div className="pointer-events-none absolute inset-0 z-[11] bg-[radial-gradient(ellipse_90%_60%_at_50%_35%,rgba(7,11,20,0.55),transparent)]" />

          <div className="relative z-20 flex min-h-0 flex-1 flex-col px-4 pb-6 pt-6 md:px-6">
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center text-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 md:mb-8"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                <span className="text-sm font-medium text-blue-300">ARIA is Live — AI Real Estate Intelligence</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="mb-4 text-4xl font-bold leading-tight tracking-tight md:mb-6 md:text-7xl lg:text-8xl"
              >
                <span className="text-white">Find Your</span>
                <br />
                <span className="bg-gradient-to-r from-blue-400 via-blue-300 to-amber-400 bg-clip-text text-transparent">
                  Perfect Property
                </span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="mx-auto mb-8 max-w-2xl text-base text-gray-400 md:mb-12 md:text-xl"
              >
                ARIA scrapes every real estate agency worldwide, analyzes pricing intelligence, and finds your perfect property —
                in any city, any country.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className="w-full max-w-xl"
              >
                <ScrapeForm />
              </motion.div>

              {/* Stats on each side of the voice orb */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.0 }}
                className="relative z-30 mt-8 flex w-full max-w-5xl flex-col items-center gap-6 md:mt-10 md:flex-row md:items-center md:justify-center md:gap-3 lg:gap-8"
              >
                <StatCounter
                  compact
                  value={stats.agencies}
                  label="Total Agencies"
                  icon={<Building2 size={STAT_ICON_COMPACT} strokeWidth={1.5} />}
                  accent="#f59e0b"
                />
                <div className="flex shrink-0 justify-center md:px-1">
                  <VoiceOrb />
                </div>
                <StatCounter
                  compact
                  value={stats.properties}
                  label="Total Properties"
                  icon={<Database size={STAT_ICON_COMPACT} strokeWidth={1.5} />}
                  accent="#60a5fa"
                />
              </motion.div>
            </div>
          </div>
        </div>

        {/* ——— Slide 2: Everything You Need ——— */}
        <div
          ref={slide2Ref}
          className="flex h-full max-h-[calc(100vh-60px)] w-full min-w-full shrink-0 snap-start snap-always flex-col items-center overflow-y-auto bg-[#070b14] px-4 py-8 md:px-8 md:py-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(37,99,235,0.14), transparent), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(226,181,90,0.08), transparent)",
          }}
        >
          <div className="mb-8 w-full max-w-4xl shrink-0 text-center md:mb-10">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400/90">Platform</p>
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">Everything You Need</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-slate-400 md:text-base">
              Three pillars — agencies, listings, and pricing intelligence. Tap a card to open.
            </p>
          </div>

          <FeatureCards />

          <button
            type="button"
            onClick={() => goToSlide(0)}
            className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 backdrop-blur transition hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to hero
          </button>
        </div>
      </div>

      {/* Slide indicators */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex max-w-[90vw] -translate-x-1/2 flex-wrap justify-center gap-2 md:bottom-5 md:gap-3">
        {[0, 1].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={i === 0 ? "Hero" : "Platform"}
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

"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Brain,
  Compass,
  Database,
  GitCompare,
  Globe2,
  Layers,
  MapPin,
  Mic,
  Sparkles,
  Telescope,
  TrendingUp,
  Wrench,
  Zap,
  HeartHandshake,
  Cpu,
  Mic2,
  Boxes,
} from "lucide-react";
import { ARIA_LIVE_ITEMS, ARIA_ROADMAP_ITEMS } from "@/data/ariaCapabilitySlides";

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

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

export default function AboutAriaPage() {
  return (
    <div className="min-h-[calc(100vh-60px)] bg-[var(--bg-base)]">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/[0.06] px-5 pb-16 pt-12 md:pb-24 md:pt-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.35), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(226,181,90,0.12), transparent)",
          }}
        />
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.div {...fadeUp} transition={{ duration: 0.45 }} className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/90">
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
            ARIA is not a generic chatbot. It is a <strong className="font-semibold text-slate-200">real-estate intelligence layer</strong>{" "}
            wired to your database, scrapers, and optional web search — tuned to sound human, stay concise, and actually{" "}
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
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-b border-white/[0.06] bg-[#070b14]/80 px-5 py-10">
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

      {/* Intelligence */}
      <section className="mx-auto max-w-5xl px-5 py-16 md:py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-white md:text-4xl">How smart is ARIA?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-400">
            Intelligence here means <strong className="text-slate-300">grounded answers</strong>, not confident hallucinations. ARIA separates small talk from work,
            picks tools deliberately, and adapts tone — professional warmth, not corporate jargon.
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

      {/* Personality */}
      <section className="border-y border-white/[0.06] bg-gradient-to-b from-transparent via-blue-950/20 to-transparent px-5 py-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-10 md:flex-row md:items-start md:gap-14">
          <div className="md:w-2/5">
            <div className="mb-4 inline-flex items-center gap-2 text-amber-200/90">
              <HeartHandshake className="h-6 w-6" />
              <span className="text-sm font-bold uppercase tracking-widest">Presence</span>
            </div>
            <h2 className="text-3xl font-bold text-white md:text-4xl">Tone & empathy</h2>
            <p className="mt-4 text-slate-400">
              Real estate is emotional — budget stress, timing, family trade-offs. ARIA is written to acknowledge that without melodrama:
              clear next steps, respectful pacing, and zero condescension.
            </p>
          </div>
          <ul className="flex-1 space-y-4 text-sm text-slate-300">
            <li className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <span className="mt-0.5 font-bold text-green-400">●</span>
              <span><strong className="text-white">Grounded enthusiasm</strong> — celebrates good fits when data supports them.</span>
            </li>
            <li className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <span className="mt-0.5 font-bold text-blue-400">●</span>
              <span><strong className="text-white">Honest uncertainty</strong> — says when something needs a scrape, a filter, or external verification.</span>
            </li>
            <li className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <span className="mt-0.5 font-bold text-amber-400">●</span>
              <span><strong className="text-white">Adaptive brevity</strong> — quick ping gets a quick reply; complex asks get structure.</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Tools */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-white md:text-4xl">Tools & skills</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-400">
            Each capability is a callable skill — not marketing jargon. Together they cover search, acquisition of new data, analysis, and narrative.
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

      {/* Live vs roadmap — same content as product overview cards */}
      <section className="border-y border-white/[0.06] bg-[#070b14]/40 px-5 py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2 lg:gap-8">
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
        </div>
      </section>

      {/* Experience CTA */}
      <section className="border-t border-white/[0.06] bg-[#070b14] px-5 py-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-gradient-to-br from-blue-950/50 to-slate-950/80 p-10 text-center">
          <Mic className="mx-auto mb-4 h-10 w-10 text-blue-400" strokeWidth={1.25} />
          <h2 className="text-2xl font-bold text-white md:text-3xl">Experience ARIA</h2>
          <p className="mx-auto mt-3 max-w-lg text-slate-400">
            Try voice on the homepage orb or the mic in chat. On the home page, scroll across from the hero to the{" "}
            <strong className="font-semibold text-slate-300">platform cards</strong> — agencies, listings, and pricing — same spirit as the sections above.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15">
              Back to home
            </Link>
            <Link href="/chat" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">
              Start chatting
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

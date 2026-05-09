"use client";

import { useId } from "react";
import { motion } from "framer-motion";

type Pose = "profile" | "front";

/**
 * One character in two poses — crossfade so it reads as a single figure turning toward you.
 */
export function AriaBotFigure({ pose, className = "" }: { pose: Pose; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gid = `aria-${uid}`;

  return (
    <svg
      viewBox="0 0 220 300"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={`skin-${gid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e3a5f" />
          <stop offset="50%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`glow-${gid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.5" />
        </linearGradient>
        <filter id={`blur-${gid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <motion.g
        initial={false}
        animate={{ opacity: pose === "profile" ? 1 : 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <ellipse cx="158" cy="145" rx="52" ry="78" fill={`url(#skin-${gid})`} stroke="rgba(148,163,184,0.35)" strokeWidth="2" />
        <ellipse cx="128" cy="130" rx="10" ry="14" fill="#0ea5e9" opacity="0.85" filter={`url(#blur-${gid})`} />
        <path
          d="M 175 95 Q 188 75 195 55"
          stroke={`url(#glow-${gid})`}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="198" cy="48" r="7" fill="#60a5fa" opacity="0.9" />
        <path d="M 132 175 Q 150 188 168 175" stroke="rgba(148,163,184,0.5)" strokeWidth="2" fill="none" />
      </motion.g>

      <motion.g
        initial={false}
        animate={{ opacity: pose === "front" ? 1 : 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <ellipse cx="110" cy="145" rx="72" ry="82" fill={`url(#skin-${gid})`} stroke="rgba(148,163,184,0.4)" strokeWidth="2" />
        <ellipse cx="82" cy="130" rx="14" ry="18" fill="#0ea5e9" opacity="0.9" filter={`url(#blur-${gid})`} />
        <ellipse cx="138" cy="130" rx="14" ry="18" fill="#0ea5e9" opacity="0.9" filter={`url(#blur-${gid})`} />
        <path d="M 110 78 Q 110 58 110 42" stroke={`url(#glow-${gid})`} strokeWidth="4" strokeLinecap="round" fill="none" />
        <circle cx="110" cy="34" r="8" fill="#60a5fa" />
        <path
          d="M 78 178 Q 110 205 142 178"
          stroke="rgba(148,163,184,0.55)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </motion.g>
    </svg>
  );
}

/** Flush to the right edge; profile on slide 3, full face on slide 4 (0-based indices 2 and 3). */
export function AriaBotStage({ activeSlide }: { activeSlide: number }) {
  const visible = activeSlide >= 2 && activeSlide <= 3;
  const pose: Pose = activeSlide === 2 ? "profile" : "front";

  return (
    <motion.div
      className="pointer-events-none fixed right-0 top-[60px] z-[35] hidden h-[calc(100vh-60px)] w-[min(44vw,420px)] md:block"
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        x: visible ? 0 : 48,
      }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      aria-hidden
    >
      <div className="flex h-full items-center justify-end pr-0">
        <motion.div
          className="origin-right"
          initial={false}
          animate={{
            rotateY: pose === "profile" ? -22 : 0,
            scale: pose === "profile" ? 0.94 : 1,
          }}
          transition={{ duration: 0.88, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformStyle: "preserve-3d", perspective: 1400 }}
        >
          <AriaBotFigure pose={pose} className="h-[min(62vh,400px)] w-auto max-w-none drop-shadow-[0_0_48px_rgba(37,99,235,0.35)]" />
        </motion.div>
      </div>
    </motion.div>
  );
}

"use client";

import Image from "next/image";

type AboutAriaToneStripProps = {
  visible: boolean;
  /** 0 = side profile, 1 = full face — driven by scroll/wheel on the Tone slide */
  portraitProgress: number;
};

export function AboutAriaToneStrip({ visible, portraitProgress }: AboutAriaToneStripProps) {
  if (!visible) return null;

  const p = Math.min(1, Math.max(0, portraitProgress));
  const sideOpacity = 1 - p;
  const fullOpacity = p;
  /** Subtle yaw so it feels like the head turns toward camera while crossfading */
  const turnDeg = (1 - p) * 14;

  return (
    <div
      className="pointer-events-none fixed bottom-0 right-0 top-[60px] z-[25] hidden w-[min(490px,42vw)] max-w-[500px] overflow-hidden lg:block"
      style={{
        backgroundColor: "#0a0f1a",
      }}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          perspective: "1200px",
          transformStyle: "preserve-3d",
        }}
      >
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `rotateY(${turnDeg}deg)`,
            transformOrigin: "65% 50%",
            opacity: sideOpacity,
          }}
        >
          <Image
            src="/assets/blue-side.jpg"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="(max-width: 1280px) 42vw, 600px"
          />
        </div>
        <div
          className="absolute inset-0 will-change-opacity"
          style={{
            opacity: fullOpacity,
          }}
        >
          <Image
            src="/assets/blue-full.jpg"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="(max-width: 1280px) 42vw, 500px"
          />
        </div>
      </div>
    </div>
  );
}

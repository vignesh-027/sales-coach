"use client";

import "./landing.css";
import { motion, useScroll, useTransform, useMotionValueEvent } from "framer-motion";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Hero } from "./sections/hero";
import { KnowledgeScene } from "./sections/knowledge-scene";
import { PipelineScene } from "./sections/pipeline-scene";
import { PatternsSection } from "./sections/patterns-section";
import { SignInSection } from "./sections/signin-section";

export function LandingClient({
  supabase,
  next,
  error,
}: {
  supabase: { url: string; anonKey: string };
  next: string;
  error?: string;
}) {
  const heroRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);

  // master hero progress: 0 at top, 1 when hero has scrolled fully out the top
  const { scrollYProgress: heroOut } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  // we want full dock by 60% of hero out
  const heroProgress = useTransform(heroOut, [0, 0.6], [0, 1], { clamp: true });

  // delta between the ghost (rest position) and the hero slot center
  const [delta, setDelta] = useState({ dx: 0, dy: 0 });
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    function measure() {
      const ghost = ghostRef.current;
      const slot = document.getElementById("lp-hero-slot");
      if (!ghost || !slot) return;
      const restRect = ghost.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const restCx = restRect.left + restRect.width / 2;
      const restCy = restRect.top + restRect.height / 2;
      const startCx = slotRect.left + slotRect.width / 2;
      const startCy = slotRect.top + slotRect.height / 2;
      setDelta({ dx: startCx - restCx, dy: startCy - restCy });
      setMeasured(true);
    }

    function runMeasure() {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(measure);
      } else {
        measure();
      }
    }
    runMeasure();
    window.addEventListener("resize", runMeasure);
    return () => window.removeEventListener("resize", runMeasure);
  }, []);

  // 0 -> CTA sits over hero slot at scale 2.2; 1 -> docked top-right at scale 1
  const x = useTransform(heroProgress, [0, 1], [delta.dx, 0]);
  const y = useTransform(heroProgress, [0, 1], [delta.dy, 0]);
  const scale = useTransform(heroProgress, [0, 1], [2.2, 1]);

  const [brandVisible, setBrandVisible] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  useMotionValueEvent(heroProgress, "change", (p) => {
    setBrandVisible(p > 0.55);
    setHintVisible(p < 0.4);
  });

  function scrollToSignin(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    const el = document.getElementById("signin");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="lp-root">
      <div className="lp-chrome">
        <span className={`lp-brand-mark ${brandVisible ? "is-visible" : ""}`}>
          <span className="lp-ic" />
          Sales Coach
        </span>
        <span />
        <span className="lp-cta-cell">
          {/* Ghost holds the rest position so we always measure it correctly,
              even when the animated CTA is transformed away from rest. */}
          <span ref={ghostRef} className="lp-cta lp-cta--ghost" aria-hidden="true">
            <span className="lp-dot" />
            Sign In
          </span>
          <motion.a
            href="#signin"
            className="lp-cta lp-cta--live"
            onClick={scrollToSignin}
            style={{ x, y, scale, opacity: measured ? 1 : 0 }}
          >
            <span className="lp-dot" />
            Sign In
          </motion.a>
        </span>
      </div>

      <motion.div
        className="lp-scroll-hint"
        animate={{ opacity: hintVisible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        <span className="lp-meta">scroll</span>
        <span className="lp-bar" />
      </motion.div>

      <Hero ref={heroRef} heroProgress={heroProgress} />
      <KnowledgeScene />
      <PipelineScene />
      <PatternsSection />
      <SignInSection supabase={supabase} next={next} error={error} />
    </div>
  );
}

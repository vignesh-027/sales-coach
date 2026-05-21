"use client";

import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { forwardRef } from "react";

export const Hero = forwardRef<HTMLElement, { heroProgress: MotionValue<number> }>(
  function Hero({ heroProgress }, ref) {
    const opacity = useTransform(heroProgress, [0, 1], [1, 0]);
    const y = useTransform(heroProgress, [0, 1], [0, -60]);

    return (
      <section ref={ref} className="lp-hero">
        <div className="lp-hero-wash" />
        <motion.div className="lp-hero-inner" style={{ opacity, y }}>
          <span className="lp-label lp-kicker">A sales coach · v0.2 · may 2026</span>
          <h1>
            Sales Coach,
            <br />
            <em>set in type.</em>
          </h1>
          <p className="lp-sub">
            A close reading of every journey closing. Where you paced, where you led,
            where the prospect heard their own future — written back to you like a draft.
          </p>
          <div className="lp-hero-cta-slot" aria-hidden="true" id="lp-hero-slot" />
        </motion.div>
      </section>
    );
  }
);

// re-export useScroll so parent can stay tidy
export { useScroll };

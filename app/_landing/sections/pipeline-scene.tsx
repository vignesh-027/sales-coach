"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

const WAVE_HEIGHTS = [6, 14, 9, 18, 22, 10, 16, 24, 13, 7, 20, 11, 17, 23, 14, 8, 19, 25, 12, 18, 9, 21, 15, 10, 6, 14, 20, 11, 17, 8];

export function PipelineScene() {
  return (
    <section className="lp-section">
      <div className="lp-stage-grid">
        <motion.div
          className="lp-stage-left"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="lp-label">02 — How it works</span>
          <h2>
            A call goes in.
            <br />
            <em>A critique comes out.</em>
          </h2>
          <p>
            Drop a closing recording. The system transcribes, attributes, and reads —
            marking the moments where you paced the hesitation, where you anchored a
            past breakthrough, where you led with certainty, and where you let a
            chance to listen go past. You get a written report and the lines that
            earned each note.
          </p>
        </motion.div>

        <div className="lp-stage-right">
          <div className="lp-pipe-stage">
            <PipeCard index={0} className="lp-pipe-card--audio">
              <span className="lp-label">01 · ingest</span>
              <div className="lp-title">Big Continuity Journey — Sabari</div>
              <span className="lp-meta">mar 10 · 32:04 · vignesh</span>
              <div className="lp-wave">
                {WAVE_HEIGHTS.map((h, i) => (
                  <i key={i} style={{ height: h }} />
                ))}
              </div>
            </PipeCard>

            <PipeCard index={1} className="lp-pipe-card--transcript">
              <span className="lp-label">02 · transcribe</span>
              <div className="lp-tx">
                <div className="lp-row"><span className="lp-ts">14:18</span><span className="lp-tt">So tell me — what would change if this was already done?</span></div>
                <div className="lp-row"><span className="lp-ts">14:22</span><span className="lp-tt lp-now">I&apos;m not sure I have the time right now for something this deep.</span></div>
                <div className="lp-row"><span className="lp-ts">14:31</span><span className="lp-tt">Right. And on the format side, we could also —</span></div>
              </div>
            </PipeCard>

            <PipeCard index={2} className="lp-pipe-card--moments">
              <span className="lp-label">03 · mark moments</span>
              <ul>
                <li><span className="lp-tag-mini">pacing</span><span style={{ flex: 1 }}>Mirrored hesitation before answering</span><span className="lp-ts2">14:24</span></li>
                <li><span className="lp-tag-mini">strong move</span><span style={{ flex: 1 }}>Named the real blocker — time, not money</span><span className="lp-ts2">14:31</span></li>
                <li><span className="lp-tag-mini">missed opp.</span><span style={{ flex: 1 }}>Didn&apos;t anchor to a past breakthrough</span><span className="lp-ts2">14:46</span></li>
              </ul>
            </PipeCard>

            <PipeCard index={3} className="lp-pipe-card--report">
              <span className="lp-label">04 · written report</span>
              <div className="lp-title">A close reading, 1,240 words</div>
              <div className="lp-row"><span>Talk ratio</span><span className="lp-v">58 / 42</span></div>
              <div className="lp-row"><span>Pivot point</span><span className="lp-v">14:22 → 14:31</span></div>
              <div className="lp-row"><span>Strong moves</span><span className="lp-v">4</span></div>
              <div className="lp-row"><span>Rewrites</span><span className="lp-v">2</span></div>
            </PipeCard>
          </div>
        </div>
      </div>
    </section>
  );
}

function PipeCard({
  index,
  className,
  children,
}: {
  index: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={`lp-pipe-card ${className}`}
      initial={{ opacity: 0, y: 40, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        duration: 0.8,
        delay: 0.15 + index * 0.18,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

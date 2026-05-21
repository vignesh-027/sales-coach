"use client";

import { motion } from "framer-motion";

type Pattern = { ts: string; body: React.ReactNode; stage: string; conf: string };

const PATTERNS: Pattern[] = [
  {
    ts: "across 18 closings",
    body: <>When the closer <strong>paces hesitation</strong> before responding, the journey signs at <strong>1.8× the rate.</strong></>,
    stage: "Closing",
    conf: "conf. 0.91",
  },
  {
    ts: "first ten minutes",
    body: <>Prospects who name a <strong>past breakthrough</strong> early book the journey <strong>42% more often.</strong></>,
    stage: "Discovery",
    conf: "conf. 0.88",
  },
  {
    ts: "after-price moment",
    body: <>Closings that <strong>hold the silence</strong> after stating the price convert <strong>34% more.</strong></>,
    stage: "Closing",
    conf: "conf. 0.94",
  },
  {
    ts: "11 closers · q1",
    body: <>When the closer names the prospect&apos;s <strong>specific outcome</strong>, drop-off after price falls by <strong>half.</strong></>,
    stage: "Closing",
    conf: "conf. 0.87",
  },
  {
    ts: "minute 20+",
    body: <>Calls that open by <strong>mirroring the prospect&apos;s pace</strong> hold attention past minute 20 <strong>2.1× more.</strong></>,
    stage: "Discovery",
    conf: "conf. 0.83",
  },
  {
    ts: "follow-up window",
    body: <>When the next step is <strong>named on the call</strong>, follow-through hits <strong>92%.</strong> When it isn&apos;t — <strong>41%.</strong></>,
    stage: "Proposal",
    conf: "conf. 0.96",
  },
];

export function PatternsSection() {
  return (
    <section className="lp-patterns-section">
      <div className="lp-moments-stage">
        <motion.div
          className="lp-heading"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="lp-label">03 — Patterns across your closers</span>
          <h2>
            The things <em>only the data</em> would tell you.
          </h2>
        </motion.div>

        <div className="lp-moments-grid">
          {PATTERNS.map((p, i) => (
            <motion.div
              key={i}
              className="lp-moment"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.8, delay: (i % 3) * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="lp-head">
                <span className="lp-tag-mini">pattern</span>
                <span className="lp-meta lp-ts">{p.ts}</span>
              </div>
              <p className="lp-pull">{p.body}</p>
              <div className="lp-meta-row">
                <span>{p.stage}</span>
                <span>{p.conf}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

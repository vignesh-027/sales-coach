"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Node = {
  label: string;
  meta: string;
  angle: number;
  r: number;
  variant?: "accent" | "ink";
};

const NODES: Node[] = [
  { label: "BiG Journey · Sabari", meta: "42 min · closing", angle: 200, r: 220 },
  { label: "FTM Journey · Kajal", meta: "38 min · exemplar", angle: 245, r: 240, variant: "accent" },
  { label: "uP Journey · Goppan", meta: "29 min", angle: 295, r: 220 },
  { label: "Playbook · pacing & leading", meta: "8 plays", angle: 340, r: 240 },
  { label: "Founder pattern · state install", meta: "Antano", angle: 25, r: 220, variant: "ink" },
  { label: "BiG Journey · Chandra Devi", meta: "34 min", angle: 70, r: 240 },
  { label: "Pattern · certainty before close", meta: "13 calls · 1.8× close", angle: 115, r: 220, variant: "accent" },
  { label: "Playbook · objection · “time”", meta: "11 plays", angle: 160, r: 240 },
];

export function KnowledgeScene() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(560);

  useEffect(() => {
    function measure() {
      if (stageRef.current) setSize(stageRef.current.clientWidth || 560);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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
          <span className="lp-label">01 — What it is</span>
          <h2>
            A library of your closings,
            <br />
            <em>read like prose.</em>
          </h2>
          <p>
            Every journey-closing call is transcribed, attributed, and
            cross-referenced against your installation playbook, the prospect&apos;s
            own words, and every other closing in the room. The result is a private
            knowledge base — your patterns, your installations, your specific way of
            moving a person — that the coach reads from.
          </p>
        </motion.div>

        <div className="lp-stage-right">
          <div className="lp-k-stage" ref={stageRef}>
            {NODES.map((n, i) => (
              <KNode key={i} node={n} index={i} size={size} />
            ))}
            <motion.div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 2,
              }}
              initial={{ opacity: 0, scale: 0.86 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.7, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="lp-k-center">
                <span className="lp-label">your knowledge</span>
                47 calls · BiG, FTM, uP · 12 playbooks
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KNode({ node, index, size }: { node: Node; index: number; size: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const scaleR = size / 560;
  const r = node.r * scaleR;
  const angleRad = (node.angle * Math.PI) / 180;
  const tx = cx + Math.cos(angleRad) * r;
  const ty = cy + Math.sin(angleRad) * r;
  const dx = Math.cos(angleRad) * r * 0.4;
  const dy = Math.sin(angleRad) * r * 0.4;

  const className =
    "lp-k-node" +
    (node.variant === "accent" ? " is-accent" : "") +
    (node.variant === "ink" ? " is-ink" : "");

  return (
    <div
      style={{
        position: "absolute",
        left: tx,
        top: ty,
        transform: "translate(-50%, -50%)",
      }}
    >
      <motion.div
        className={className}
        initial={{ opacity: 0, x: dx, y: dy, scale: 0.7 }}
        whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{
          duration: 0.7,
          delay: index * 0.07,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {node.label}
        <span className="lp-meta">{node.meta}</span>
      </motion.div>
    </div>
  );
}

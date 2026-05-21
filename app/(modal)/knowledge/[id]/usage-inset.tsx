"use client";

import { useEffect, useState } from "react";

interface Usage {
  knowledge_item_id: string;
  appearances: number;
  kept_count: number;
  dropped_count: number;
  last_used_at: string | null;
}

interface ApiResponse {
  historical: boolean;
  usage: Usage;
  note?: string;
}

export function KnowledgeUsageInset({ itemId }: { itemId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/knowledge/${itemId}/usage`);
        if (!res.ok) throw new Error(await res.text());
        const j = (await res.json()) as ApiResponse;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (err) {
    return (
      <div className="stats-card" style={{ marginTop: 16 }}>
        <div className="stats-warn">usage inset unavailable: {err}</div>
      </div>
    );
  }
  if (!data) return null;

  const u = data.usage;
  if (data.historical || u.appearances === 0) {
    return (
      <div className="stats-card" style={{ marginTop: 16 }}>
        <div className="stats-line" style={{ opacity: 0.7 }}>
          {data.note ?? "Not yet used in any analysis."}
        </div>
      </div>
    );
  }

  const last = u.last_used_at ? new Date(u.last_used_at).toLocaleString() : "—";
  return (
    <div className="stats-card" style={{ marginTop: 16 }}>
      <div className="stats-line">
        <span className="k">used in</span>
        <span className="v">{u.appearances} analyses</span>
        <span className="k">·</span>
        <span className="v">kept {u.kept_count}</span>
        <span className="k">·</span>
        <span className="v">dropped {u.dropped_count}</span>
        <span className="k">·</span>
        <span className="v">last {last}</span>
      </div>
    </div>
  );
}

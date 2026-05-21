"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { DictCombobox, type DictOption } from "@/app/_components/dict-combobox";
import {
  MEDIA_ACCEPT_ATTR,
  validateUpload,
} from "@/services/upload/allowed-formats";

type CallType = "pre_sale" | "sales_followup" | "sales_closing";

interface TypeOption {
  value: CallType;
  title: string;
  sub: string;
}

const TYPES: TypeOption[] = [
  { value: "pre_sale", title: "Pre-sale", sub: "discovery · qualification" },
  {
    value: "sales_followup",
    title: "Sales-followup",
    sub: "continuity · next steps",
  },
  {
    value: "sales_closing",
    title: "Sales-closing",
    sub: "objections · commitment",
  },
];

const ACCEPT = MEDIA_ACCEPT_ATTR;

function bytes(n: number): string {
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} mb`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} gb`;
}
function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function AddInner({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const initialType = (params.get("type") as CallType) ?? "pre_sale";
  const [callType, setCallType] = useState<CallType>(
    TYPES.find((t) => t.value === initialType) ? initialType : "pre_sale",
  );
  const [salesperson, setSalesperson] = useState<DictOption | null>(null);
  const [client, setClient] = useState<DictOption | null>(null);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const addFiles = useCallback((picked: File[]) => {
    const accepted: File[] = [];
    const reasons: string[] = [];
    for (const f of picked) {
      const v = validateUpload(f.name, f.type);
      if (!v.ok || v.format === "text") {
        reasons.push(v.reason ?? `${f.name}: unsupported`);
      } else {
        accepted.push(f);
      }
    }
    if (reasons.length > 0) {
      setError(reasons.join(" · "));
    } else {
      setError(null);
    }
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    function pickFromDT(dt: DataTransfer | null): File[] {
      if (!dt) return [];
      const out: File[] = [];
      if (dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) out.push(dt.files[i]);
      } else if (dt.items) {
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i];
          if (it.kind === "file") {
            const f = it.getAsFile();
            if (f) out.push(f);
          }
        }
      }
      return out;
    }

    function onWindowDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onWindowDrop(e: DragEvent) {
      e.preventDefault();
    }
    function onElDragEnter(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }
    function onElDragOver(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
    function onElDragLeave(e: DragEvent) {
      if (e.target === el) setDragOver(false);
    }
    function onElDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const picked = pickFromDT(e.dataTransfer);
      if (picked.length === 0) {
        setError("Couldn't read the dropped file(s). Try clicking to browse.");
        return;
      }
      addFiles(picked);
    }

    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    el.addEventListener("dragenter", onElDragEnter);
    el.addEventListener("dragover", onElDragOver);
    el.addEventListener("dragleave", onElDragLeave);
    el.addEventListener("drop", onElDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      el.removeEventListener("dragenter", onElDragEnter);
      el.removeEventListener("dragover", onElDragOver);
      el.removeEventListener("dragleave", onElDragLeave);
      el.removeEventListener("drop", onElDrop);
    };
  }, [addFiles]);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    [next[i], next[j]] = [next[j], next[i]];
    setFiles(next);
  }
  function remove(i: number) {
    setFiles((prev) => prev.filter((_, k) => k !== i));
  }

  async function submit() {
    if (files.length === 0 || !salesperson || !client || busy) return;
    setBusy(true);
    setError(null);
    try {
      setStep("Creating call…");
      const createRes = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          call_type: callType,
          salesperson_id: salesperson.id,
          client_id: client.id,
          salesperson_name: salesperson.name,
          client_name: client.name,
          title: title.trim() || undefined,
          files: files.map((f) => ({
            filename: f.name,
            contentType: f.type || "application/octet-stream",
          })),
        }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const created = (await createRes.json()) as {
        callId: string;
        recordings: Array<{ id: string; uploadUrl: string }>;
      };

      for (let i = 0; i < files.length; i++) {
        setStep(`Uploading ${i + 1} / ${files.length}…`);
        const f = files[i];
        const rec = created.recordings[i];
        // Direct PUT to R2 via presigned URL — going through a Next.js API
        // route would cap the body at the platform limit (10 MB on Vercel
        // by default, silently truncating longer files).
        const putRes = await fetch(rec.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": f.type || "application/octet-stream",
          },
          body: f,
        });
        if (!putRes.ok)
          throw new Error(`upload ${i} failed: ${putRes.status} ${await putRes.text()}`);
      }

      setStep("Starting processing…");
      const startRes = await fetch(`/api/calls/${created.callId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!startRes.ok) throw new Error(await startRes.text());

      router.push("/calls");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const canSubmit =
    files.length > 0 && !!salesperson && !!client && !busy;

  return (
    <div className="modal-shell">
      <header className="top-bar">
        <Link href="/calls" className="back" aria-label="Back to calls">
          <span className="ico">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </span>
          <span className="lbl">Back</span>
        </Link>
        <span className="modal-title">Add call</span>
        <span />
      </header>

      <div className="col">
        <div className="headline-block">
          <h1 className="headline">Drop a call to coach.</h1>
          <p className="dek">
            Recordings get transcribed, embedded, and analyzed against the
            founder&apos;s playbook to produce an AI report.
          </p>
        </div>

        <div className="kind-picker">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`kind-option ${callType === t.value ? "active" : ""}`}
              onClick={() => setCallType(t.value)}
            >
              <div className="ko-title">{t.title}</div>
              <div className="ko-sub">{t.sub}</div>
            </button>
          ))}
        </div>

        <div
          ref={dropRef}
          className={`drop ${dragOver ? "dragover" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <div className="drop-inner">
            <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 v12" />
              <polyline points="7,8 12,3 17,8" />
              <path d="M4 15 v4 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-4" />
            </svg>
            <p className="drop-title">
              {dragOver
                ? "Release to add"
                : files.length === 0
                  ? "Drop call recording(s) here"
                  : "Drop more recordings"}
            </p>
            <p className="drop-sub">
              {files.length === 0
                ? "or click to browse — audio or video"
                : "multiple files? order them as the call actually went — earliest first."}
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            hidden
            multiple
            onChange={(e) => {
              const fs = e.target.files;
              if (!fs) return;
              const arr: File[] = [];
              for (let i = 0; i < fs.length; i++) arr.push(fs[i]);
              addFiles(arr);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <div className="file-queue">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="file-row">
                <span className="idx">{String(i).padStart(2, "0")}</span>
                <span className="name">{f.name}</span>
                <span className="size">{bytes(f.size)}</span>
                <button
                  type="button"
                  className="reorder-btn"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="reorder-btn"
                  disabled={i === files.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="remove-btn"
                  onClick={() => remove(i)}
                  style={{ gridColumn: "1 / -1", justifySelf: "end" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="fields">
          <DictCombobox
            label="Salesperson"
            placeholder="e.g. Alex"
            role="salesperson"
            value={salesperson}
            onChange={setSalesperson}
            canCreate
          />
          <DictCombobox
            label="Client"
            placeholder="e.g. Acme Inc."
            role="client"
            value={client}
            onChange={setClient}
            canCreate
          />
          <div className="field">
            <span className="field-label">Title — optional</span>
            <input
              className="uline"
              type="text"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="defaults to <client> · <call_type> · <date>"
            />
          </div>
        </div>

        {error && <p className="err-text">{error}</p>}

        <div className="submit-row">
          <span className="submit-hint">
            {busy
              ? step
              : "Transcribe → Embed → AI Report. Takes a few minutes."}
          </span>
          <button
            className="submit-btn"
            type="button"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? "Working…" : "Start coaching"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AddCallClient({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Suspense fallback={<p className="loading-mono">loading…</p>}>
      <AddInner isAdmin={isAdmin} />
    </Suspense>
  );
}

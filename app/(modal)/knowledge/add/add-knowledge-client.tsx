"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  MEDIA_ACCEPT_ATTR,
  TEXT_ACCEPT_ATTR,
  VIDEO_ACCEPT_ATTR,
  validateUpload,
} from "@/services/upload/allowed-formats";

type Kind = "founder_video" | "reference_call" | "text_document";

interface KindOption {
  value: Kind;
  title: string;
  sub: string;
  accept: string;
  allowedFormat: "video" | "audio_or_video" | "text";
}

const KINDS: KindOption[] = [
  {
    value: "founder_video",
    title: "Founder video",
    sub: "mp4 · mov · webm",
    accept: VIDEO_ACCEPT_ATTR,
    allowedFormat: "video",
  },
  {
    value: "reference_call",
    title: "Reference call",
    sub: "mp3 · m4a · wav · mp4",
    accept: MEDIA_ACCEPT_ATTR,
    allowedFormat: "audio_or_video",
  },
  {
    value: "text_document",
    title: "Text document",
    sub: ".txt · .md · .docx",
    accept: TEXT_ACCEPT_ATTR,
    allowedFormat: "text",
  },
];

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

function AddInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialKind = (params.get("kind") as Kind) ?? "founder_video";
  const [kind, setKind] = useState<Kind>(
    KINDS.find((k) => k.value === initialKind) ? initialKind : "founder_video",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const opt = KINDS.find((k) => k.value === kind)!;

  function matchesKind(format: "audio" | "video" | "text" | undefined): boolean {
    if (!format) return false;
    if (opt.allowedFormat === "text") return format === "text";
    if (opt.allowedFormat === "video") return format === "video";
    return format === "audio" || format === "video";
  }

  // Reset file if kind changes and current file no longer matches
  useEffect(() => {
    if (file) {
      const v = validateUpload(file.name, file.type);
      if (!v.ok || !matchesKind(v.format)) setFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const onPick = useCallback(
    (f: File | null) => {
      if (!f) {
        setFile(null);
        return;
      }
      const v = validateUpload(f.name, f.type);
      if (!v.ok) {
        setError(v.reason ?? `Unsupported file: ${f.name}`);
        return;
      }
      if (!matchesKind(v.format)) {
        setError(
          `That file is ${v.format} — pick a ${opt.sub.replace(/\s/g, "")} file for "${opt.title}".`,
        );
        return;
      }
      setError(null);
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opt, title],
  );

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    function pickFromDT(dt: DataTransfer | null): File | null {
      if (!dt) return null;
      if (dt.files && dt.files.length > 0) return dt.files[0];
      if (dt.items) {
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i];
          if (it.kind === "file") {
            const f = it.getAsFile();
            if (f) return f;
          }
        }
      }
      return null;
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
      const f = pickFromDT(e.dataTransfer);
      if (!f) {
        setError("Couldn't read the dropped file. Try clicking to browse instead.");
        return;
      }
      onPick(f);
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
  }, [onPick, file]);

  async function submit() {
    if (!file || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setStep("Creating item…");
      const createRes = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description: description.trim() || undefined,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const created = (await createRes.json()) as {
        id: string;
        uploadUrl: string;
      };

      setStep("Uploading to storage…");
      // Upload directly to R2 via the presigned PUT URL. Going through a
      // Next.js API route would cap us at the platform's request-body limit
      // (10 MB on Vercel by default — that silently truncated longer files).
      const putRes = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`upload failed: ${putRes.status} ${await putRes.text()}`);

      setStep("Starting processing…");
      const startRes = await fetch(`/api/knowledge/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!startRes.ok) throw new Error(await startRes.text());

      router.push("/knowledge");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const canSubmit = !!file && !!title.trim() && !busy;

  return (
    <div className="modal-shell">
      <header className="top-bar">
        <Link href="/knowledge" className="back" aria-label="Back to knowledge">
          <span className="ico">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </span>
          <span className="lbl">Back</span>
        </Link>
        <span className="modal-title">Add knowledge source</span>
        <span />
      </header>

      <div className="col">
        <div className="headline-block">
          <h1 className="headline">Teach the coach.</h1>
          <p className="dek">
            Upload a founder video, a reference sales call, or a text playbook.
            It&apos;ll be transcribed (if media), embedded, and added to what
            the coach can draw on — it won&apos;t be scored.
          </p>
        </div>

        <div className="kind-picker">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className={`kind-option ${kind === k.value ? "active" : ""}`}
              onClick={() => setKind(k.value)}
            >
              <div className="ko-title">{k.title}</div>
              <div className="ko-sub">{k.sub}</div>
            </button>
          ))}
        </div>

        {!file ? (
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
                {dragOver ? "Release to add" : "Drop your file here"}
              </p>
              <p className="drop-sub">
                or click to browse — {opt.sub.toUpperCase()}
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={opt.accept}
              hidden
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <div className="file-row">
            <svg className="file-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 1.5 h7 l3 3 v12 a1 1 0 0 1 -1 1 h-9 a1 1 0 0 1 -1 -1 v-14 a1 1 0 0 1 1 -1 z" />
              <polyline points="10.5,1.5 10.5,4.5 13.5,4.5" />
            </svg>
            <div className="file-info">
              <span className="file-name">{file.name}</span>
              <div className="file-meta">
                <span>{bytes(file.size)}</span>
                <span className="sep" />
                <span>.{extOf(file.name)}</span>
              </div>
            </div>
            <button
              className="remove-btn"
              type="button"
              onClick={() => setFile(null)}
            >
              Remove
            </button>
          </div>
        )}

        <div className="fields">
          <div className="field">
            <span className="field-label">Title</span>
            <input
              className="uline"
              type="text"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. How we position against incumbents"
            />
          </div>
          <div className="field">
            <span className="field-label">Description — optional</span>
            <textarea
              className="uline"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this source cover?"
            />
          </div>
        </div>

        {error && <p className="err-text">{error}</p>}

        <div className="submit-row">
          <span className="submit-hint">
            {busy
              ? step
              : kind === "text_document"
                ? "Document will be embedded immediately. No transcription needed."
                : "Transcription runs automatically. No quality score is given to knowledge sources."}
          </span>
          <button
            className="submit-btn"
            type="button"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? "Working…" : "Add to knowledge"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AddKnowledgeClient() {
  return (
    <Suspense fallback={<p className="loading-mono">loading…</p>}>
      <AddInner />
    </Suspense>
  );
}

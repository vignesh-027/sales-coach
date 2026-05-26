"use client";

import { useState } from "react";

interface LlmOptionView {
  id: string;
  label: string;
  description: string;
  tier: "paid";
  cost_per_mtok_input: number;
  cost_per_mtok_output: number;
}

interface RerankOptionView {
  id: string;
  label: string;
  description: string;
  tier: "paid";
  cost_per_mtok: number;
}

interface TranscriptionOptionView {
  id: string;
  label: string;
  description: string;
  provider: "assemblyai" | "runpod";
  tier: "paid";
  cost_per_hr_audio: number;
}

interface EmbeddingInfo {
  provider: string;
  model: string;
  dim: number;
  notes: string;
}

export function ConfigurationClient({
  initialLlmModel,
  initialRerankModel,
  initialTranscriptionModel,
  llmOptions,
  rerankOptions,
  transcriptionOptions,
  embedding,
}: {
  initialLlmModel: string;
  initialRerankModel: string;
  initialTranscriptionModel: string;
  llmOptions: LlmOptionView[];
  rerankOptions: RerankOptionView[];
  transcriptionOptions: TranscriptionOptionView[];
  embedding: EmbeddingInfo;
}) {
  const [llmModel, setLlmModel] = useState(initialLlmModel);
  const [rerankModel, setRerankModel] = useState(initialRerankModel);
  const [transcriptionModel, setTranscriptionModel] = useState(
    initialTranscriptionModel,
  );
  const [savingLlm, setSavingLlm] = useState(false);
  const [savingRerank, setSavingRerank] = useState(false);
  const [savingTranscription, setSavingTranscription] = useState(false);
  const [errLlm, setErrLlm] = useState<string | null>(null);
  const [errRerank, setErrRerank] = useState<string | null>(null);
  const [errTranscription, setErrTranscription] = useState<string | null>(null);
  const selected = llmOptions.find((o) => o.id === llmModel);
  const selectedRerank = rerankOptions.find((o) => o.id === rerankModel);
  const selectedTranscription = transcriptionOptions.find(
    (o) => o.id === transcriptionModel,
  );

  async function patchSettings(body: Record<string, string>): Promise<void> {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = await res.text();
      try {
        msg = (JSON.parse(msg) as { error?: string }).error ?? msg;
      } catch {}
      throw new Error(msg);
    }
  }

  async function onChangeModel(next: string) {
    const prev = llmModel;
    setLlmModel(next);
    setErrLlm(null);
    setSavingLlm(true);
    try {
      await patchSettings({ llm_model: next });
    } catch (e) {
      setLlmModel(prev);
      setErrLlm(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLlm(false);
    }
  }

  async function onChangeRerank(next: string) {
    const prev = rerankModel;
    setRerankModel(next);
    setErrRerank(null);
    setSavingRerank(true);
    try {
      await patchSettings({ rerank_model: next });
    } catch (e) {
      setRerankModel(prev);
      setErrRerank(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRerank(false);
    }
  }

  async function onChangeTranscription(next: string) {
    const prev = transcriptionModel;
    setTranscriptionModel(next);
    setErrTranscription(null);
    setSavingTranscription(true);
    try {
      await patchSettings({ transcription_model: next });
    } catch (e) {
      setTranscriptionModel(prev);
      setErrTranscription(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTranscription(false);
    }
  }

  return (
    <section className="settings-tiles">
      <div className="settings-tile">
        <div className="settings-tile-left">
          <h3>Vector Embedding</h3>
          <p>
            Used to index every call and knowledge source. Locked in code —
            changing it requires re-embedding the whole dataset.
          </p>
        </div>
        <div className="settings-tile-right">
          <div className="settings-tile-value">{embedding.model}</div>
          <div className="settings-tile-meta">
            {embedding.provider} · {embedding.dim}-d · {embedding.notes}
          </div>
        </div>
      </div>

      <div className="settings-tile">
        <div className="settings-tile-left">
          <h3>Transcription engine</h3>
          <p>
            Provider used to transcribe call audio and knowledge sources.
            Switch anytime; the next upload picks it up. Existing
            transcripts are not re-run.
          </p>
          {selectedTranscription && (
            <p className="settings-tile-modelnote">
              {selectedTranscription.description} ·{" "}
              {selectedTranscription.tier} · $
              {selectedTranscription.cost_per_hr_audio.toFixed(3)}/hr audio
              (estimated)
            </p>
          )}
          {errTranscription && (
            <p className="err-text" style={{ marginTop: 8 }}>
              {errTranscription}
            </p>
          )}
        </div>
        <div className="settings-tile-right">
          <select
            className="settings-select"
            value={transcriptionModel}
            disabled={savingTranscription}
            onChange={(e) => void onChangeTranscription(e.target.value)}
          >
            {transcriptionOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="settings-tile-meta">
            {savingTranscription ? "saving…" : "saved"}
          </div>
        </div>
      </div>

      <div className="settings-tile">
        <div className="settings-tile-left">
          <h3>LLM for Call Quality</h3>
          <p>
            Used to analyze each call and produce the structured report.
            Switch anytime; the next analysis picks it up.
          </p>
          {selected && (
            <p className="settings-tile-modelnote">
              {selected.description} · {selected.tier} · $
              {selected.cost_per_mtok_input.toFixed(2)}/$
              {selected.cost_per_mtok_output.toFixed(2)} per 1M tokens
              (input/output)
            </p>
          )}
          {errLlm && <p className="err-text" style={{ marginTop: 8 }}>{errLlm}</p>}
        </div>
        <div className="settings-tile-right">
          <select
            className="settings-select"
            value={llmModel}
            disabled={savingLlm}
            onChange={(e) => void onChangeModel(e.target.value)}
          >
            {llmOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="settings-tile-meta">
            {savingLlm ? "saving…" : "saved"}
          </div>
        </div>
      </div>

      <div className="settings-tile">
        <div className="settings-tile-left">
          <h3>Reranker model</h3>
          <p>
            Re-orders the top-50 retrieval candidates before Claude sees them.
            Cheap and fast; flip if retrieval ever feels off.
          </p>
          {selectedRerank && (
            <p className="settings-tile-modelnote">
              {selectedRerank.description} · {selectedRerank.tier} · $
              {selectedRerank.cost_per_mtok.toFixed(2)} per 1M tokens
            </p>
          )}
          {errRerank && (
            <p className="err-text" style={{ marginTop: 8 }}>{errRerank}</p>
          )}
        </div>
        <div className="settings-tile-right">
          <select
            className="settings-select"
            value={rerankModel}
            disabled={savingRerank}
            onChange={(e) => void onChangeRerank(e.target.value)}
          >
            {rerankOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="settings-tile-meta">
            {savingRerank ? "saving…" : "saved"}
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

function EmailCell({
  userId,
  initial,
  locked,
  onSaved,
}: {
  userId: string;
  initial: string | null;
  locked: boolean;
  onSaved: (next: string | null) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const original = useRef(initial ?? "");

  useEffect(() => {
    setValue(initial ?? "");
    original.current = initial ?? "";
  }, [initial]);

  async function commit() {
    const next = value.trim();
    if (next === original.current.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: next || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      original.current = next;
      onSaved(next || null);
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(original.current);
    setEditing(false);
  }

  return (
    <div className="email-cell">
      <input
        className="uline-inline"
        type="email"
        value={value}
        disabled={locked || saving}
        title={
          locked
            ? "Email is locked because this user has signed in. It's now their auth identity."
            : undefined
        }
        onFocus={() => !locked && setEditing(true)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      />
      {editing && !locked && (
        <div className="email-cell-acts">
          <button
            type="button"
            className="icon-btn icon-btn-ok"
            aria-label="Save email"
            disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void commit()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2.5,6.5 5,9 9.5,3.5" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-cancel"
            aria-label="Cancel"
            disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancel}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_admin: boolean;
  is_salesperson: boolean;
  is_client: boolean;
  auth_user_id: string | null;
  created_at: string;
}

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

interface EmbeddingInfo {
  provider: string;
  model: string;
  dim: number;
  notes: string;
}

function SettingsTiles({
  initialLlmModel,
  initialRerankModel,
  llmOptions,
  rerankOptions,
  embedding,
}: {
  initialLlmModel: string;
  initialRerankModel: string;
  llmOptions: LlmOptionView[];
  rerankOptions: RerankOptionView[];
  embedding: EmbeddingInfo;
}) {
  const [llmModel, setLlmModel] = useState(initialLlmModel);
  const [rerankModel, setRerankModel] = useState(initialRerankModel);
  const [savingLlm, setSavingLlm] = useState(false);
  const [savingRerank, setSavingRerank] = useState(false);
  const [errLlm, setErrLlm] = useState<string | null>(null);
  const [errRerank, setErrRerank] = useState<string | null>(null);
  const selected = llmOptions.find((o) => o.id === llmModel);
  const selectedRerank = rerankOptions.find((o) => o.id === rerankModel);

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

export function AdminUsersClient({
  initialUsers,
  initialLlmModel,
  initialRerankModel,
  llmOptions,
  rerankOptions,
  embedding,
}: {
  initialUsers: UserRow[];
  initialLlmModel: string;
  initialRerankModel: string;
  llmOptions: LlmOptionView[];
  rerankOptions: RerankOptionView[];
  embedding: EmbeddingInfo;
}) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);

  function updateLocal(id: string, patch: Partial<UserRow>) {
    setUsers((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save(row: UserRow) {
    setSavingId(row.id);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: row.name,
          email: row.email,
          phone: row.phone,
          is_admin: row.is_admin,
          is_salesperson: row.is_salesperson,
          is_client: row.is_client,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function doDelete(row: UserRow) {
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setUsers((rows) => rows.filter((r) => r.id !== row.id));
      setConfirmDelete(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <main className="shell">
        <section className="page-head">
          <h1 className="top-title">
            Manage users<span className="dot">.</span>
          </h1>
          <p className="sub">
            Names and Email are mandatory. Flip a flag to grant
            admin access, mark someone as a salesperson, or mark them as a client.
          </p>
        </section>

        <SettingsTiles
          initialLlmModel={initialLlmModel}
          initialRerankModel={initialRerankModel}
          llmOptions={llmOptions}
          rerankOptions={rerankOptions}
          embedding={embedding}
        />

        <section className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Admin</th>
                <th>Salesperson</th>
                <th>Client</th>
                <th>Logged in?</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      className="uline-inline"
                      value={u.name}
                      onChange={(e) => updateLocal(u.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <EmailCell
                      userId={u.id}
                      initial={u.email}
                      locked={!!u.auth_user_id}
                      onSaved={(next) => updateLocal(u.id, { email: next })}
                    />
                  </td>
                  <td>
                    <input
                      className="uline-inline"
                      value={u.phone ?? ""}
                      onChange={(e) =>
                        updateLocal(u.id, { phone: e.target.value || null })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.is_admin}
                      onChange={(e) => updateLocal(u.id, { is_admin: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.is_salesperson}
                      onChange={(e) =>
                        updateLocal(u.id, { is_salesperson: e.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.is_client}
                      onChange={(e) => updateLocal(u.id, { is_client: e.target.checked })}
                    />
                  </td>
                  <td>{u.auth_user_id ? "yes" : "—"}</td>
                  <td>
                    <button
                      className="btn"
                      type="button"
                      disabled={savingId === u.id}
                      onClick={() => save(u)}
                    >
                      {savingId === u.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      className="btn btn-danger"
                      type="button"
                      style={{ marginLeft: 8 }}
                      disabled={deletingId === u.id}
                      onClick={() => setConfirmDelete(u)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="confirm-title">Delete user?</h2>
            <p className="confirm-body">
              Remove <strong>{confirmDelete.name}</strong>
              {confirmDelete.email ? ` (${confirmDelete.email})` : ""}? Their
              past calls will keep the recorded name but lose the link.
            </p>
            <div className="acts">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId === confirmDelete.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-confirm-danger"
                onClick={() => doDelete(confirmDelete)}
                disabled={deletingId === confirmDelete.id}
              >
                {deletingId === confirmDelete.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

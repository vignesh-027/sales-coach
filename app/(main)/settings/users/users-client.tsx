"use client";

import { useEffect, useRef, useState } from "react";

function PencilIcon() {
  return (
    <svg
      className="edit-pencil"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" />
    </svg>
  );
}

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
    <div className={`email-cell${locked ? " is-locked" : ""}`}>
      <input
        className="uline-inline"
        type="email"
        value={value}
        placeholder={locked ? "" : "Add"}
        disabled={locked || saving}
        title={
          locked
            ? `${value || ""}${value ? "\n\n" : ""}Email is locked because this user has signed in. It's now their auth identity.`
            : value || undefined
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
      {!editing && !locked && <PencilIcon />}
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

export function UsersClient({ initialUsers }: { initialUsers: UserRow[] }) {
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
      <p className="sub" style={{ marginBottom: 16 }}>
        Names and Email are mandatory. Flip a flag to grant admin access, mark
        someone as a salesperson, or mark them as a client.
      </p>

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
                  <div className="editable-cell">
                    <input
                      className="uline-inline"
                      value={u.name}
                      placeholder="Add"
                      title={u.name || undefined}
                      onChange={(e) => updateLocal(u.id, { name: e.target.value })}
                    />
                    <PencilIcon />
                  </div>
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
                  <div className="editable-cell">
                    <input
                      className="uline-inline"
                      value={u.phone ?? ""}
                      placeholder="Add"
                      title={u.phone || undefined}
                      onChange={(e) =>
                        updateLocal(u.id, { phone: e.target.value || null })
                      }
                    />
                    <PencilIcon />
                  </div>
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
                  <div className="row-actions">
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
                      disabled={deletingId === u.id}
                      onClick={() => setConfirmDelete(u)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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

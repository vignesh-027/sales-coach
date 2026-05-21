"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DictOption {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export function DictCombobox({
  label,
  placeholder,
  role,
  value,
  onChange,
  canCreate = false,
}: {
  label: string;
  placeholder: string;
  role: "salesperson" | "client";
  value: DictOption | null;
  onChange: (v: DictOption) => void;
  canCreate?: boolean;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DictOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  // Two-step create: fill form → confirm dialog → POST. Confirmation is
  // required for both roles so the user gets a chance to spot typos in the
  // name/email before we write a row that other people will see.
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setText(value?.name ?? "");
  }, [value]);

  const fetchOptions = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ role });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/users?${params.toString()}`);
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as { users: DictOption[] };
        setOptions(json.users);
      } finally {
        setLoading(false);
      }
    },
    [role],
  );

  useEffect(() => {
    if (!open || adding) return;
    const t = window.setTimeout(() => void fetchOptions(text), 150);
    return () => window.clearTimeout(t);
  }, [open, adding, text, fetchOptions]);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setAddError(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const exactMatch = options.find(
    (o) => o.name.toLowerCase() === text.trim().toLowerCase(),
  );
  const canAddNew =
    canCreate && open && !adding && text.trim().length > 0 && !exactMatch && !loading;

  function pick(o: DictOption) {
    onChange(o);
    setText(o.name);
    setOpen(false);
    setAdding(false);
    setConfirming(false);
    setNewName("");
    setNewEmail("");
    setAddError(null);
  }

  function startAddNew() {
    setNewName(text.trim());
    setNewEmail("");
    setAddError(null);
    setAdding(true);
    setConfirming(false);
    setOpen(false);
  }

  // Role-aware client-side validation. Mirrored server-side in /api/users.
  //   salesperson: name + email mandatory, email must be @soexcellence.com
  //   client     : name mandatory, email optional and any domain accepted
  function validateNew(): string | null {
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name) return "Name is required.";
    if (role === "salesperson") {
      if (!email) return "Email is required for salespersons.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return "That doesn't look like a valid email.";
      }
      if (!/@soexcellence\.com$/i.test(email)) {
        return "Salesperson email must end with @soexcellence.com.";
      }
    } else {
      // client — email optional, any domain
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return "That doesn't look like a valid email.";
      }
    }
    return null;
  }

  function requestConfirm() {
    if (creating) return;
    const err = validateNew();
    if (err) {
      setAddError(err);
      return;
    }
    setAddError(null);
    setConfirming(true);
  }

  async function submitNew() {
    if (creating) return;
    const name = newName.trim();
    const email = newEmail.trim();
    setCreating(true);
    setAddError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || null,
          role,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { user: DictOption };
      pick(json.user);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="field" ref={rootRef}>
      <span className="field-label">{label}</span>
      <input
        className="uline"
        type="text"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setAdding(false);
        }}
      />
      {open && (
        <div className="combo-list" role="listbox">
          {!adding && loading && <div className="combo-row muted">searching…</div>}
          {!adding && !loading &&
            options.map((o) => (
              <div
                key={o.id}
                role="option"
                aria-selected={value?.id === o.id}
                className="combo-row"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                <span className="combo-name">{o.name}</span>
                {(o.email || o.phone) && (
                  <span className="role">{o.email ?? o.phone}</span>
                )}
              </div>
            ))}
          {canAddNew && (
            <button
              type="button"
              className="combo-row add-new"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => startAddNew()}
            >
              <span className="plus">+</span>
              <span>Add new user</span>
            </button>
          )}
          {!loading && options.length === 0 && !canAddNew && (
            <div className="combo-row muted">No matches</div>
          )}
        </div>
      )}

      {adding && (
        <div
          className="dict-modal-overlay"
          onClick={() => {
            if (!creating) {
              setAdding(false);
              setAddError(null);
            }
          }}
        >
          <div
            className="dict-modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="dict-modal-title">Add new {role}</h2>
            <p className="dict-modal-sub">
              {role === "salesperson"
                ? "Salesperson email must be on the @soexcellence.com domain."
                : "Email is optional for clients."}
              {" "}If the email already exists, we&apos;ll just add the {role} role
              to that person instead of creating a duplicate.
            </p>
            <div className="dict-modal-field">
              <span className="dict-modal-label">Name</span>
              <input
                className="uline"
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    requestConfirm();
                  }
                }}
              />
            </div>
            <div className="dict-modal-field">
              <span className="dict-modal-label">
                Email{role === "client" ? " (optional)" : ""}
              </span>
              <input
                className="uline"
                type="email"
                placeholder={
                  role === "salesperson"
                    ? "person@soexcellence.com"
                    : "person@example.com (optional)"
                }
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    requestConfirm();
                  }
                }}
              />
            </div>
            {addError && <div className="dict-modal-err">{addError}</div>}
            <div className="dict-modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-confirm-danger"
                style={{ background: "var(--accent, #111)", borderColor: "var(--accent, #111)" }}
                onClick={() => requestConfirm()}
                disabled={creating}
              >
                Continue
              </button>
            </div>
          </div>

          {confirming && (
            <div
              className="dict-modal-overlay"
              style={{ zIndex: 10 }}
              onClick={() => {
                if (!creating) setConfirming(false);
              }}
            >
              <div
                className="dict-modal-card"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="dict-modal-title">Add this {role}?</h2>
                <p className="dict-modal-sub">
                  <strong>{newName.trim()}</strong>
                  {newEmail.trim() ? (
                    <>
                      {" "}— <span style={{ opacity: 0.8 }}>{newEmail.trim()}</span>
                    </>
                  ) : null}
                </p>
                {addError && <div className="dict-modal-err">{addError}</div>}
                <div className="dict-modal-actions">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setConfirming(false)}
                    disabled={creating}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-confirm-danger"
                    style={{ background: "var(--accent, #111)", borderColor: "var(--accent, #111)" }}
                    onClick={() => void submitNew()}
                    disabled={creating}
                  >
                    {creating ? "Adding…" : "Confirm add"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

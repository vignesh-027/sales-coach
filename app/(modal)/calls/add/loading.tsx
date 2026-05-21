export default function Loading() {
  return (
    <div className="modal-shell">
      <header className="top-bar">
        <span />
        <span className="modal-title">Upload call</span>
        <span />
      </header>
      <main className="detail-shell">
        <p className="loading-mono">loading…</p>
      </main>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="modal-shell">
      <header className="top-bar">
        <span />
        <span className="modal-title">Call detail</span>
        <span />
      </header>
      <div className="cd-grid">
        <aside className="sidebar" />
        <main className="content">
          <p className="loading-mono">loading…</p>
        </main>
      </div>
    </div>
  );
}

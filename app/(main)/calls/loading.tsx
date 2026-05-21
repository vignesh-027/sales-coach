// Layout above us owns the persistent NavHeader. Only the body needs a
// loading skeleton.
export default function Loading() {
  return (
    <main className="shell">
      <p className="loading-mono">loading…</p>
    </main>
  );
}

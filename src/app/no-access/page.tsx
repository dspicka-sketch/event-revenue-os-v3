export default function NoAccess() {
  return (
    <main style={{ maxWidth: 520, margin: "10vh auto", padding: 16 }}>
      <div className="card stack">
        <h1>No project access</h1>
        <p>You are signed in, but this account is not an active member of the project. Ask the project owner to add you.</p>
        <a href="/login">Back to sign in</a>
      </div>
    </main>
  );
}

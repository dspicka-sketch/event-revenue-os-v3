export async function Flash({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const msg = typeof sp.msg === "string" ? sp.msg : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  if (!msg && !error) return null;
  return (
    <div className={`notice ${error ? "danger" : ""}`} role={error ? "alert" : "status"} style={{ marginBottom: 16 }}>
      {error ?? msg}
    </div>
  );
}

export type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

import { getDb } from "@/lib/data/context";
import { SideNav, MobileNav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = await getDb();
  const who = `${db.userEmail ?? db.userId} · ${db.role}`;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {db.mode === "demo" ? (
        <div className="banner demo" role="status">
          DEMO MODE — synthetic and inherited fixture data only. Nothing here is live, persisted, or sent.
        </div>
      ) : null}
      <MobileNav />
      <div className="shell">
        <SideNav who={who} />
        <main id="main">{children}</main>
      </div>
    </>
  );
}

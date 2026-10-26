"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  ["/", "Overview"],
  ["/workstreams", "Workstreams"],
  ["/evidence", "Evidence"],
  ["/decisions", "Decisions"],
  ["/property", "Property"],
  ["/governance", "Governance"],
  ["/funding", "Funding"],
  ["/stakeholders", "Stakeholders"],
  ["/tasks", "Risks & tasks"],
  ["/review", "Review queue"],
  ["/runs", "Briefings & runs"],
  ["/settings", "Settings"],
] as const;

function isCurrent(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function SideNav({ who }: { who: string }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      <div className="brand">Protect 104 N. Main</div>
      {NAV.map(([href, label]) => (
        <Link key={href} href={href} aria-current={isCurrent(path, href) ? "page" : undefined}>
          {label}
        </Link>
      ))}
      <div className="who">{who}</div>
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  const current = NAV.find(([href]) => isCurrent(path, href))?.[1] ?? "Menu";
  return (
    <div className="mobile-nav">
      <details>
        <summary>
          <span>Protect 104 · {current}</span>
          <span aria-hidden>☰</span>
        </summary>
        <nav aria-label="Primary (mobile)">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={isCurrent(path, href) ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </details>
    </div>
  );
}

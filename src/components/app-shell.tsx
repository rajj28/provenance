import Link from "next/link";
import { signOutAction } from "@/app/actions";
import type { User } from "@prisma/client";

const links = [
  { href: "/app", label: "Overview" },
  { href: "/app/sources", label: "Sources" },
  { href: "/app/discoveries", label: "Discoveries" },
  { href: "/app/reviews", label: "Review" },
  { href: "/app/portfolio", label: "Portfolio" },
  { href: "/app/settings", label: "Settings" },
];

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink/8 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/app" className="serif text-xl">
            Provenance
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-ink-soft md:flex">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-ink">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link href={`/p/${user.slug}`} className="hidden text-ink-soft hover:text-ink sm:inline">
              Public page
            </Link>
            <form action={signOutAction}>
              <button className="text-ink-soft hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="flex gap-4 overflow-x-auto px-5 pb-3 text-sm text-ink-soft md:hidden">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}

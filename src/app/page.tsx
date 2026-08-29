import Link from "next/link";
import { optionalUser } from "@/lib/session";

export default async function HomePage() {
  const user = await optionalUser();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <span className="serif text-2xl">Provenance</span>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <Link href="/app" className="rounded-full bg-copper px-4 py-2 text-paper">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-ink-soft hover:text-ink">
                Sign in
              </Link>
              <Link href="/signup" className="rounded-full bg-copper px-4 py-2 text-paper">
                Start free
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-5 pb-8 pt-16 text-center">
        <p className="text-xs uppercase tracking-[0.22em] text-copper-deep">Professional evidence engine</p>
        <h1 className="serif mt-5 text-5xl leading-[1.05] sm:text-7xl">
          A portfolio that updates itself from the work you already did.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-soft">
          Connect the places your work lives. We discover what is actually significant, explain why it
          matters, and wait for your approval before anything is published.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="rounded-full bg-ink px-5 py-3 text-sm text-paper">
            Connect a source
          </Link>
          <Link href="/login" className="rounded-full border border-ink/15 px-5 py-3 text-sm">
            I already have an account
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-20 md:grid-cols-3">
        {[
          ["Connect", "GitHub first, plus GitLab, npm, PyPI, Dev.to, Hashnode, arXiv, ORCID, and Kaggle."],
          ["Understand", "Stars are not a career. We score substance, skip typo PRs, and keep provenance."],
          ["Approve", "Nothing important publishes without you. Rejected items stay rejected unless the evidence changes."],
        ].map(([title, body]) => (
          <article key={title} className="rounded-[28px] border border-ink/10 bg-white/55 p-6">
            <h2 className="serif text-3xl">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">{body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

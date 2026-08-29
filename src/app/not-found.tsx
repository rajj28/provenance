import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">404</p>
      <h1 className="serif mt-3 text-4xl">Nothing here</h1>
      <p className="mt-3 text-ink-soft">
        This page does not exist, or the portfolio behind it is set to private.
      </p>
      <Link href="/" className="mt-6 inline-flex rounded-full bg-ink px-4 py-2 text-sm text-paper">
        Go home
      </Link>
    </div>
  );
}

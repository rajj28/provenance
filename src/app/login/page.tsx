import { SignInForm } from "@/components/auth-form";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <Link href="/" className="serif mb-8 text-2xl">
        Provenance
      </Link>
      <h1 className="serif text-4xl">Welcome back</h1>
      <p className="mt-2 text-sm text-ink-soft">Sign in to review discoveries and keep your portfolio current.</p>
      {params.error ? <p className="mt-4 text-sm text-[#9b2c2c]">{params.error}</p> : null}
      <SignInForm />
      <p className="mt-6 text-sm text-ink-soft">
        New here?{" "}
        <Link href="/signup" className="text-ink underline">
          Create an account
        </Link>
      </p>
    </main>
  );
}

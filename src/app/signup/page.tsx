import { SignUpForm } from "@/components/auth-form";
import Link from "next/link";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <Link href="/" className="serif mb-8 text-2xl">
        Provenance
      </Link>
      <h1 className="serif text-4xl">Create your workspace</h1>
      <p className="mt-2 text-sm text-ink-soft">Five minutes to connect GitHub and see what actually belongs on a portfolio.</p>
      <SignUpForm />
      <p className="mt-6 text-sm text-ink-soft">
        Already have an account?{" "}
        <Link href="/login" className="text-ink underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

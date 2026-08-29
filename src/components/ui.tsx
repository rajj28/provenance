import Link from "next/link";
import type { ReactNode } from "react";

export function Button({
  children,
  href,
  variant = "primary",
  ...props
}: {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "ghost" | "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls =
    variant === "primary"
      ? "bg-copper text-paper hover:bg-copper-deep"
      : variant === "danger"
        ? "bg-transparent text-[#9b2c2c] border border-[#9b2c2c]/30 hover:bg-[#9b2c2c]/8"
        : "bg-transparent text-ink border border-ink/15 hover:bg-ink/5";
  const className = `inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition ${cls}`;
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button className={className} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-ink/10 bg-white/70 p-5 shadow-[0_1px_0_rgba(28,23,18,0.04)] ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "copper" | "pine" | "warn" }) {
  const map = {
    ink: "bg-ink/8 text-ink",
    copper: "bg-copper/12 text-copper-deep",
    pine: "bg-pine/12 text-pine",
    warn: "bg-[#9b2c2c]/10 text-[#9b2c2c]",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${map[tone]}`}>{children}</span>;
}

export function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required,
  textarea,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  const inputCls =
    "mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm outline-none focus:border-copper";
  return (
    <label className="block text-sm">
      <span className="text-ink-soft">{label}</span>
      {textarea ? (
        <textarea name={name} defaultValue={defaultValue} placeholder={placeholder} className={`${inputCls} min-h-28`} />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          className={inputCls}
        />
      )}
    </label>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-ink/15 px-6 py-14 text-center">
      <h3 className="serif text-2xl">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function statusTone(status: string) {
  if (status === "connected") return "pine" as const;
  if (status === "syncing") return "copper" as const;
  if (status === "approved") return "pine" as const;
  if (status === "pending") return "copper" as const;
  return "warn" as const;
}

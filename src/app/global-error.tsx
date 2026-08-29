"use client";

/**
 * Replaces the root layout when the layout itself fails, so it must render its
 * own <html>/<body> and cannot rely on global styles.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", textAlign: "center" }}>
        <title>Something went wrong</title>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#666", marginBottom: "1.5rem" }}>
          The application failed to render.{error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <button
          onClick={() => retry()}
          style={{ padding: "0.5rem 1.25rem", borderRadius: "999px", border: "1px solid #ccc", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

"use client";
import { btn } from "@/components/ui/primitives";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-soft">The error has been logged{error.digest ? ` (reference ${error.digest})` : ""}. Please try again.</p>
      <button className={btn("primary", "mt-5")} onClick={reset}>Try again</button>
    </div>
  );
}

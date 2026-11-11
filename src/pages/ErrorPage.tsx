import { useEffect, useState } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle, Copy, RotateCw } from "lucide-react";
import { Button } from "../components/ui/Button";

/** Shown instead of a blank window when a page crashes. The rest of the app keeps working. */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const [copied, setCopied] = useState(false);
  const details = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);

  useEffect(() => {
    console.error("Page crashed:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-20 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-surface-2 text-warning">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">This page ran into a problem</h1>
      <p className="text-muted">Your downloads and music aren't affected. Try again, or go to another page.</p>
      <div className="flex gap-2">
        <Button variant="primary" icon={<RotateCw />} onClick={reset}>
          Try again
        </Button>
        <Button
          icon={<Copy />}
          onClick={() => navigator.clipboard.writeText(details).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy details"}
        </Button>
      </div>
    </div>
  );
}

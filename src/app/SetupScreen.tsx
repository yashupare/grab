import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCw, ShieldCheck, XCircle } from "lucide-react";
import { api, type ToolPackage, type ToolProgress } from "../lib/ipc";
import { errorMessage } from "../hooks/useSettings";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";

type RowState =
  | { phase: "waiting" }
  | { phase: "downloading"; received: number; total: number }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "failed"; message: string };

const mb = (b: number) => `${(b / 1_000_000).toFixed(b >= 10_000_000 ? 0 : 1)} MB`;

function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-(--ease-soft)" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

function SetupScreen({ packages, onDone }: { packages: ToolPackage[]; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(packages.map((p) => [p.id, { phase: "waiting" } as RowState])),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function start() {
    setRunning(true);
    setError(null);
    setRows((r) => Object.fromEntries(Object.entries(r).map(([id, s]) => [id, s.phase === "done" ? s : { phase: "waiting" }])));
    try {
      await api.installTools();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onToolProgress((p: ToolProgress) => {
        setRows((r) => {
          const next: RowState =
            p.phase === "downloading"
              ? { phase: "downloading", received: p.received, total: p.total }
              : p.phase === "failed"
                ? { phase: "failed", message: p.message }
                : { phase: p.phase };
          return { ...r, [p.id]: next };
        });
      })
      .then((u) => {
        unlisten = u;
        // Start automatically on first launch: there's nothing to decide.
        if (!started.current) {
          started.current = true;
          void start();
        }
      });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = packages.reduce((s, p) => s + p.size, 0);
  const received = packages.reduce((s, p) => {
    const r = rows[p.id];
    if (r?.phase === "downloading") return s + r.received;
    if (r?.phase === "installing" || r?.phase === "done") return s + p.size;
    return s;
  }, 0);

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-[560px]">
        <h1 className="text-[28px] leading-[34px] font-[650] tracking-[-0.02em]">Setting up Grab</h1>
        <p className="mt-2 text-muted">
          Grab needs a few free tools to download and process media. This is a one-time download of about {mb(total)}.
        </p>
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <ShieldCheck className="size-4 text-success" aria-hidden />
          Each file comes from its official source and is checked against its known fingerprint before it's installed.
        </p>

        <div className="mt-6 rounded-lg border border-line bg-surface-1 p-5">
          <div className="mb-2 flex justify-between text-[13px] text-muted">
            <span>{error ? "Setup didn't finish" : running ? "Downloading…" : "Ready"}</span>
            <span className="tabular">
              {mb(received)} of {mb(total)}
            </span>
          </div>
          <Bar value={total ? received / total : 0} />

          <ul className="mt-5 flex flex-col gap-4">
            {packages.map((p) => {
              const r = rows[p.id] ?? { phase: "waiting" };
              let status: ReactNode;
              if (r.phase === "waiting") status = <span className="text-faint">Waiting</span>;
              else if (r.phase === "downloading")
                status = <span className="tabular">{mb(r.received)} / {mb(r.total)}</span>;
              else if (r.phase === "installing")
                status = (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking & installing
                  </span>
                );
              else if (r.phase === "done")
                status = (
                  <span className="flex items-center gap-1.5 text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden /> Ready
                  </span>
                );
              else
                status = (
                  <span className="flex items-center gap-1.5 text-danger">
                    <XCircle className="size-3.5" aria-hidden /> Failed
                  </span>
                );
              return (
                <li key={p.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">
                      {p.label} <span className="font-mono text-[12px] font-normal text-faint">{p.version}</span>
                    </span>
                    <span className="shrink-0 text-[13px] text-muted">{status}</span>
                  </div>
                  {r.phase === "downloading" && <Bar className="mt-2 h-1" value={r.total ? r.received / r.total : 0} />}
                  {r.phase === "failed" && <p className="selectable mt-1 text-[13px] text-danger">{r.message}</p>}
                </li>
              );
            })}
          </ul>
        </div>

        {error && !running && (
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" icon={<RotateCw />} onClick={start}>
              Try again
            </Button>
            <span className="text-[13px] text-muted">Finished tools are kept; only the failed ones download again.</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shows first-launch setup until every tool is installed; afterwards renders the app. */
export function SetupGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const missing = useQuery({ queryKey: ["tools-missing"], queryFn: api.toolsMissing, staleTime: Infinity, retry: false });

  if (missing.isPending) return <div className="flex-1" />;
  // Not in the desktop app (e.g. plain browser during UI work): nothing to set up.
  if (missing.isError || missing.data.length === 0) return <>{children}</>;

  return (
    <SetupScreen
      packages={missing.data}
      onDone={() => {
        qc.invalidateQueries({ queryKey: ["tools"] });
        qc.setQueryData(["tools-missing"], []);
      }}
    />
  );
}

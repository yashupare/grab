/** First run: where files go → how it looks → ready. Shown once; Skip is always available. */
import { useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Clapperboard, FolderOpen, Monitor, Moon, Music2, Sun } from "lucide-react";
import type { Settings, Theme } from "../lib/ipc";
import { errorMessage, useSettings, useUpdateSettings } from "../hooks/useSettings";
import { useUi } from "../stores/ui";
import { toast } from "../stores/toasts";
import { Button } from "../components/ui/Button";
import { Kbd } from "../components/ui/IconButton";
import { cn } from "../lib/cn";

export function WelcomeGate({ children }: { children: ReactNode }) {
  const settings = useSettings();
  if (settings.isPending) return <div className="flex-1" />;
  // Outside the desktop app (UI work in a browser) there are no settings: skip.
  if (!settings.data || settings.data.welcomed) return <>{children}</>;
  return <Welcome s={settings.data} />;
}

function FolderRow({
  icon: Icon,
  label,
  path,
  onChange,
}: {
  icon: typeof Music2;
  label: string;
  path: string;
  onChange: (p: string) => void;
}) {
  async function pick() {
    const chosen = await openDialog({ directory: true, defaultPath: path, title: `Folder for ${label.toLowerCase()}` });
    if (typeof chosen === "string") onChange(chosen);
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        <div className="truncate font-mono text-[12.5px] text-muted" title={path}>
          {path}
        </div>
      </div>
      <Button size="sm" icon={<FolderOpen />} onClick={() => pick().catch((e) => toast.error(errorMessage(e)))}>
        Change
      </Button>
    </div>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Like Windows", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

function Welcome({ s }: { s: Settings }) {
  const [step, setStep] = useState(0);
  const update = useUpdateSettings();
  const theme = useUi((u) => u.theme);
  const setTheme = useUi((u) => u.setTheme);
  const reduce = useReducedMotion();
  const save = (p: Partial<Settings>) => update.mutate(p, { onError: (e) => toast.error(errorMessage(e)) });
  const finish = () => save({ welcomed: true });

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: "Where should Grab save things?",
      body: (
        <div className="flex flex-col gap-2.5">
          <FolderRow icon={Clapperboard} label="Videos" path={s.videoDir} onChange={(videoDir) => save({ videoDir })} />
          <FolderRow icon={Music2} label="Music" path={s.musicDir} onChange={(musicDir) => save({ musicDir })} />
          <p className="text-[13px] text-muted">
            Songs in your music folder show up in Music. You can add more folders later in Settings.
          </p>
        </div>
      ),
    },
    {
      title: "How should it look?",
      body: (
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="radio"
              aria-checked={theme === value}
              onClick={() => {
                setTheme(value);
                save({ theme: value });
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border px-3 py-5 transition-colors",
                theme === value ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2",
              )}
            >
              <Icon className="size-6" aria-hidden />
              <span className="font-medium">{label}</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "You're all set",
      body: (
        <ul className="flex flex-col gap-3 text-[15px]">
          <li>
            <span className="font-medium">Paste a link anywhere</span> <Kbd>Ctrl V</Kbd>: YouTube, Spotify, and 1000+
            other sites.
          </li>
          <li>
            <span className="font-medium">Find anything</span> <Kbd>Ctrl K</Kbd>: songs, pages and actions.
          </li>
          <li>
            <span className="font-medium">Play and pause</span> <Kbd>Space</Kbd>, or use your keyboard's media keys,
            even when Grab is in the tray.
          </li>
        </ul>
      ),
    },
  ];
  const last = step === steps.length - 1;
  const cur = steps[step]!;

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-[560px]">
        <div className="mb-6 flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-3")}
            />
          ))}
        </div>
        {step === 0 && (
          <p className="mb-1 text-[13px] font-medium tracking-[0.06em] text-accent uppercase">Welcome to Grab</p>
        )}
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
        >
          <h1 className="mb-5 text-[26px] leading-tight font-bold tracking-[-0.02em]">{cur.title}</h1>
          {cur.body}
        </motion.div>
        <div className="mt-8 flex items-center gap-2">
          {!last && (
            <Button variant="ghost" onClick={finish}>
              Skip
            </Button>
          )}
          <span className="flex-1" />
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          <Button
            variant="primary"
            size="lg"
            icon={last ? undefined : <ArrowRight />}
            onClick={() => (last ? finish() : setStep(step + 1))}
            autoFocus
          >
            {last ? "Start using Grab" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

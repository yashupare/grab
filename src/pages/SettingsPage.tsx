import { useState, type ReactNode } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, FolderOpen, Monitor, Moon, RefreshCw, Sun, XCircle } from "lucide-react";
import { Switch } from "../components/ui/Switch";
import { toast } from "../stores/toasts";
import { PageHeader } from "../components/ui/PageHeader";
import { Segmented } from "../components/ui/Segmented";
import { Button } from "../components/ui/Button";
import { useUi } from "../stores/ui";
import { errorMessage, useSettings, useUpdateSettings } from "../hooks/useSettings";
import { api, type AudioFormat, type Settings, type SponsorBlock, type Theme, type VideoQuality } from "../lib/ipc";
import { cn } from "../lib/cn";
import { useAppUpdate, useCheckForUpdate, useInstallUpdate } from "../hooks/useAppUpdate";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Open-source parts Grab ships or downloads, with their licences. */
const LICENCES: { name: string; licence: string; url: string; note?: string }[] = [
  { name: "yt-dlp", licence: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp", note: "downloads media" },
  {
    name: "FFmpeg",
    licence: "GPL v3 (gyan.dev essentials build)",
    url: "https://ffmpeg.org/legal.html",
    note: "video and audio processing",
  },
  { name: "aria2", licence: "GPL v2", url: "https://github.com/aria2/aria2", note: "faster downloads" },
  {
    name: "Node.js",
    licence: "MIT",
    url: "https://github.com/nodejs/node/blob/main/LICENSE",
    note: "YouTube playback challenges",
  },
  { name: "Tauri", licence: "MIT / Apache-2.0", url: "https://tauri.app" },
  { name: "React, TanStack, Radix UI, Lucide", licence: "MIT / ISC", url: "https://github.com/yashupare/grab" },
  { name: "lofty, rusqlite, souvlaki, notify", licence: "MIT / Apache-2.0", url: "https://github.com/yashupare/grab" },
  { name: "Inter, JetBrains Mono", licence: "SIL Open Font License", url: "https://github.com/rsms/inter" },
];

export const SETTINGS_SECTIONS = [
  "general",
  "downloads",
  "music",
  "tools",
  "spotify",
  "updates",
  "advanced",
  "about",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const LABELS: Record<SettingsSection, string> = {
  general: "General",
  downloads: "Downloads",
  music: "Music",
  tools: "Tools",
  spotify: "Spotify",
  updates: "Updates",
  advanced: "Advanced",
  about: "About",
};

/** Settings that exist in the plan but whose feature isn't built yet. */
const PLANNED: Partial<Record<SettingsSection, { items: string[]; milestone: string }>> = {
  downloads: { milestone: "M6", items: ["File name pattern", "Speed limit"] },
  music: { milestone: "a later version", items: ["Normalise volume"] },
  spotify: { milestone: "M3", items: ["Connect your Spotify account (Premium) for playlists over 100 songs"] },
  advanced: { milestone: "M1", items: ["Cookies for age-restricted videos", "Proxy", "Copy diagnostics", "Reset app"] },
};

const route = getRouteApi("/settings");

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-0">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function PathValue({ path, onChange }: { path: string; onChange?: (p: string) => void }) {
  async function pick() {
    const chosen = await openDialog({ directory: true, defaultPath: path, title: "Choose a folder" });
    if (typeof chosen === "string" && chosen !== path) onChange?.(chosen);
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="selectable mr-1 truncate font-mono text-[12.5px] text-muted" title={path}>
        {path}
      </span>
      <Button
        size="sm"
        variant="ghost"
        icon={<FolderOpen />}
        onClick={() => revealItemInDir(path).catch(() => {})}
        aria-label={`Show ${path}`}
      >
        Show
      </Button>
      {onChange && (
        <Button size="sm" onClick={() => pick().catch((e) => toast.error(errorMessage(e)))}>
          Change
        </Button>
      )}
    </div>
  );
}

function AutostartRow() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["autostart"], queryFn: api.autostartGet, retry: false });
  const set = useMutation({
    mutationFn: api.autostartSet,
    onSuccess: (v) => qc.setQueryData(["autostart"], v),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Row
      title="Start with Windows"
      description="Grab starts in the tray when you sign in, ready for media keys and downloads."
    >
      <Switch label="Start with Windows" checked={q.data ?? false} onChange={(v) => set.mutate(v)} />
    </Row>
  );
}

function GeneralSection({ s, save }: { s?: Settings; save: (p: Partial<Settings>) => void }) {
  const setThemeLocal = useUi((st) => st.setTheme);
  const theme = useUi((st) => st.theme);
  return (
    <>
      <Row title="Theme" description="Follow Windows, or always use dark or light.">
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={(t) => {
            setThemeLocal(t);
            save({ theme: t });
          }}
          options={[
            { value: "system", label: "System", icon: Monitor },
            { value: "dark", label: "Dark", icon: Moon },
            { value: "light", label: "Light", icon: Sun },
          ]}
        />
      </Row>
      {s && (
        <Row
          title="Keep running in the tray when closed"
          description="The close button hides Grab next to the clock: music keeps playing and downloads finish. Right-click the tray icon to quit."
        >
          <Switch
            label="Keep running in the tray"
            checked={s.closeToTray}
            onChange={(closeToTray) => save({ closeToTray })}
          />
        </Row>
      )}
      <AutostartRow />
      {s && (
        <Row
          title="Notifications"
          description="Show a Windows notification when a download finishes while Grab is in the background."
        >
          <Switch
            label="Notifications"
            checked={s.notifications}
            onChange={(notifications) => save({ notifications })}
          />
        </Row>
      )}
    </>
  );
}

function GrabUpdateRow({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.appInfo });
  const available = useAppUpdate().data;
  const check = useCheckForUpdate();
  const { install, progress } = useInstallUpdate();
  return (
    <>
      <Row
        title="Grab"
        description={
          available ? (
            <>
              <span className="font-medium text-accent">Version {available.version} is ready to install.</span> Grab
              closes, updates and reopens; downloads in progress should finish first.
              {available.notes && (
                <span className="selectable mt-1 block whitespace-pre-line text-muted">{available.notes}</span>
              )}
            </>
          ) : (
            "Updates come from GitHub and are checked for a valid signature before installing."
          )
        }
      >
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[13px] text-muted">v{info.data?.version ?? "…"}</span>
          {available ? (
            <Button size="sm" variant="primary" loading={install.isPending} onClick={() => install.mutate()}>
              {progress != null && progress > 0 ? `Downloading ${Math.round(progress * 100)}%` : "Install and restart"}
            </Button>
          ) : (
            <Button size="sm" icon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate()}>
              Check now
            </Button>
          )}
        </div>
      </Row>
      <Row
        title="Update Grab automatically"
        description="Checks once a day and lets you know when a new version is ready. Nothing installs without your OK."
      >
        <Switch
          label="Update Grab automatically"
          checked={s.autoUpdate}
          onChange={(autoUpdate) => save({ autoUpdate })}
        />
      </Row>
    </>
  );
}

function UpdatesSection() {
  const tools = useQuery({ queryKey: ["tools"], queryFn: api.toolStatus, staleTime: 60_000 });
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: api.updateYtdlp,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["tools"] });
      if (!r.updated) toast.success(`The downloader is up to date (${r.after}).`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ytdlp = tools.data?.find((t) => t.name === "yt-dlp");
  return (
    <Row
      title="Downloader (yt-dlp)"
      description="Checked automatically once a day. Sites like YouTube change often; updates keep downloads working."
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-[13px] text-muted">{ytdlp?.version ?? "…"}</span>
        <Button size="sm" icon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate()}>
          Check now
        </Button>
      </div>
    </Row>
  );
}

function DownloadsSection({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  return (
    <>
      <Row title="Video folder">
        <PathValue path={s.videoDir} onChange={(videoDir) => save({ videoDir })} />
      </Row>
      <Row title="Music folder">
        <PathValue path={s.musicDir} onChange={(musicDir) => save({ musicDir })} />
      </Row>
      <Row title="Default video quality" description="Pre-selected when you open a video. Lower if it's not available.">
        <Segmented<VideoQuality>
          label="Default video quality"
          value={s.videoQuality}
          onChange={(videoQuality) => save({ videoQuality })}
          options={[
            { value: "best", label: "Best" },
            { value: "2160", label: "4K" },
            { value: "1440", label: "1440p" },
            { value: "1080", label: "1080p" },
            { value: "720", label: "720p" },
          ]}
        />
      </Row>
      <Row
        title="Default audio format"
        description={
          {
            opus: "Opus: best quality, original stream, no re-encoding.",
            m4a: "M4A (AAC): original stream, plays on every device.",
            mp3: "MP3: converted for old devices. Converting can't add quality.",
          }[s.audioFormat]
        }
      >
        <Segmented<AudioFormat>
          label="Default audio format"
          value={s.audioFormat}
          onChange={(audioFormat) => save({ audioFormat })}
          options={[
            { value: "opus", label: "Opus" },
            { value: "m4a", label: "M4A" },
            { value: "mp3", label: "MP3" },
          ]}
        />
      </Row>
      <Row title="Simultaneous downloads" description="More is faster for playlists, but uses more bandwidth.">
        <Segmented<string>
          label="Simultaneous downloads"
          value={String(s.concurrentDownloads)}
          onChange={(v) => save({ concurrentDownloads: Number(v) })}
          options={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n }))}
        />
      </Row>
      <Row
        title="Sponsor segments"
        description="Default for YouTube videos. Uses SponsorBlock, where viewers mark sponsor reads."
      >
        <Segmented<SponsorBlock>
          label="Sponsor segments default"
          value={s.sponsorblock}
          onChange={(sponsorblock) => save({ sponsorblock })}
          options={[
            { value: "off", label: "Keep" },
            { value: "remove", label: "Remove" },
            { value: "mark", label: "Mark" },
          ]}
        />
      </Row>
      <Row
        title="Subtitle languages"
        description="Pre-selected when a video has them. Language codes, e.g. en, hi, es."
      >
        <LangInput value={s.subtitleLangs} onSave={(subtitleLangs) => save({ subtitleLangs })} />
      </Row>
    </>
  );
}

const LANG = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;

function LangInput({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  const [error, setError] = useState(false);
  function commit() {
    const codes = [
      ...new Set(
        text
          .split(/[\s,]+/)
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const bad = codes.some((c) => !LANG.test(c));
    setError(bad);
    if (!bad && codes.join(",") !== value.join(",")) onSave(codes);
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      placeholder="None"
      aria-label="Subtitle languages"
      aria-invalid={error}
      className={cn(
        "h-9 w-48 rounded-md border bg-surface-2 px-3 text-[13px] outline-none placeholder:text-faint focus:border-muted",
        error ? "border-danger" : "border-line",
      )}
    />
  );
}

const CROSSFADES = [0, 2, 4, 6, 8, 12] as const;

function MusicSection({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const lib = useQuery({ queryKey: ["library"], queryFn: api.libraryTracks, staleTime: Infinity });
  const extra = s.libraryDirs.filter((d) => d.toLowerCase() !== s.musicDir.toLowerCase());
  async function add() {
    const chosen = await openDialog({ directory: true, title: "Add a music folder" });
    if (typeof chosen !== "string") return;
    if ([s.musicDir, ...s.libraryDirs].some((d) => d.toLowerCase() === chosen.toLowerCase())) {
      toast.info("That folder is already in your library.");
      return;
    }
    save({ libraryDirs: [...s.libraryDirs, chosen] });
    toast.success("Folder added. Looking for songs…");
  }
  return (
    <>
      <Row
        title="Library folders"
        description={
          <>
            Songs in these folders (and their subfolders) appear in Music. Your download folder is always included.
            {lib.data && ` ${lib.data.tracks.length} songs found${lib.data.scanning ? ", still looking…" : "."}`}
          </>
        }
      >
        <div className="flex min-w-0 flex-col items-end gap-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <span className="selectable truncate font-mono text-[12.5px] text-muted" title={s.musicDir}>
              {s.musicDir}
            </span>
            <span className="rounded bg-surface-3 px-1.5 text-[11px] font-medium text-muted">Downloads</span>
          </div>
          {extra.map((d) => (
            <div key={d} className="flex min-w-0 items-center gap-1">
              <span className="selectable truncate font-mono text-[12.5px] text-muted" title={d}>
                {d}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => save({ libraryDirs: s.libraryDirs.filter((x) => x !== d) })}
                aria-label={`Remove ${d}`}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="mt-1 flex gap-2">
            <Button
              size="sm"
              icon={<RefreshCw />}
              onClick={() => api.libraryRescan().then(() => toast.info("Scanning your music folders…"))}
            >
              Scan again
            </Button>
            <Button size="sm" icon={<FolderOpen />} onClick={() => add().catch((e) => toast.error(errorMessage(e)))}>
              Add folder
            </Button>
          </div>
        </div>
      </Row>
      <Row
        title="Crossfade"
        description="Fade each song into the next. Off plays each song to its end, then starts the next."
      >
        <Segmented<string>
          label="Crossfade"
          value={String(s.crossfade)}
          onChange={(v) => save({ crossfade: Number(v) })}
          options={CROSSFADES.map((c) => ({ value: String(c), label: c === 0 ? "Off" : `${c} s` }))}
        />
      </Row>
    </>
  );
}

function ToolsSection({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const info = useQuery({ queryKey: ["tools-info", s.hardwareAccel], queryFn: api.toolsInfo, staleTime: 60_000 });
  const found = info.data?.hardware ?? [];
  return (
    <Row
      title="Hardware acceleration"
      description={
        info.isPending
          ? "Checking your graphics card…"
          : found.length
            ? `Uses ${found[0]} to make Merge, Trim (precise) and Convert faster. Compress always uses the software encoder, which hits sizes exactly.`
            : "No working hardware video encoder was found (NVIDIA, Intel or AMD), so Tools use the software encoder."
      }
    >
      <Switch
        label="Hardware acceleration"
        checked={s.hardwareAccel && found.length > 0}
        onChange={(hardwareAccel) => save({ hardwareAccel })}
      />
    </Row>
  );
}

function AboutSection() {
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.appInfo });
  const tools = useQuery({ queryKey: ["tools"], queryFn: api.toolStatus, staleTime: 60_000 });
  return (
    <>
      <Row title="Grab" description="Download, play and edit your media. Free and open source.">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[13px] text-muted">v{info.data?.version ?? "…"}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openUrl("https://github.com/yashupare/grab").catch(() => {})}
          >
            Source on GitHub
          </Button>
        </div>
      </Row>
      {info.data && (
        <>
          <Row title="App data" description={`Database schema v${info.data.schemaVersion}`}>
            <PathValue path={info.data.dataDir} />
          </Row>
          <Row title="Logs" description="Attach these when reporting a problem.">
            <PathValue path={info.data.logDir} />
          </Row>
        </>
      )}
      <div className="py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">Built-in tools</div>
          <Button size="sm" variant="ghost" loading={tools.isFetching} onClick={() => tools.refetch()}>
            Check again
          </Button>
        </div>
        {tools.error && <p className="text-danger">{errorMessage(tools.error)}</p>}
        <ul className="divide-y divide-line rounded-md border border-line">
          {(tools.data ?? []).map((t) => {
            const ok = t.source === "installed" || t.source === "bundled";
            const Icon = ok ? CheckCircle2 : t.source === "system" ? AlertTriangle : XCircle;
            return (
              <li key={t.name} className="flex items-center gap-3 px-4 py-3">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    ok ? "text-success" : t.source === "system" ? "text-warning" : "text-danger",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {t.name} <span className="font-mono text-[12px] font-normal text-muted">{t.version ?? ""}</span>
                  </div>
                  <div className="text-[13px] text-muted">{t.purpose}</div>
                </div>
                <span className="text-[12px] text-muted">
                  {ok ? "Installed" : t.source === "system" ? "From this PC (dev only)" : "Missing"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="border-t border-line py-4">
        <div className="mb-3 font-medium">Open-source licences</div>
        <ul className="grid gap-1.5 text-[13px]">
          {LICENCES.map((l) => (
            <li key={l.name} className="flex items-baseline justify-between gap-4">
              <button className="text-left font-medium hover:underline" onClick={() => openUrl(l.url).catch(() => {})}>
                {l.name}
                {l.note && <span className="font-normal text-muted"> · {l.note}</span>}
              </button>
              <span className="shrink-0 text-muted">{l.licence}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12.5px] text-faint">
          Download only what you have the right to. Grab doesn't bypass copy protection (DRM).
        </p>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { section = "general" } = route.useSearch();
  const settings = useSettings();
  const update = useUpdateSettings();
  const planned = PLANNED[section];
  const s = settings.data;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-[200px_1fr] gap-8">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {SETTINGS_SECTIONS.map((sec) => (
            <Link
              key={sec}
              to="/settings"
              search={{ section: sec }}
              className={cn(
                "rounded-md px-3 py-2 font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg",
                sec === section && "bg-surface-2 text-fg",
              )}
            >
              {LABELS[sec]}
            </Link>
          ))}
        </nav>

        <section className="min-w-0 rounded-lg border border-line bg-surface-1 px-6 py-2">
          <h2 className="pt-4 pb-1 text-xl font-semibold">{LABELS[section]}</h2>
          {settings.error && <p className="py-3 text-danger">{errorMessage(settings.error)}</p>}
          {update.error && <p className="py-3 text-danger">{errorMessage(update.error)}</p>}

          {section === "general" && <GeneralSection s={s} save={(p) => update.mutate(p)} />}
          {section === "updates" && (
            <>
              {s && <GrabUpdateRow s={s} save={(p) => update.mutate(p)} />}
              <UpdatesSection />
            </>
          )}
          {section === "downloads" && s && <DownloadsSection s={s} save={(p) => update.mutate(p)} />}
          {section === "music" && s && <MusicSection s={s} save={(p) => update.mutate(p)} />}
          {section === "tools" && s && <ToolsSection s={s} save={(p) => update.mutate(p)} />}
          {section === "about" && <AboutSection />}

          {planned && (
            <div className="border-t border-line py-4 first:border-0">
              <p className="mb-3 text-[13px] text-muted">Coming in {planned.milestone}:</p>
              <ul className="flex flex-col gap-2">
                {planned.items.map((i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-muted before:size-1.5 before:rounded-full before:bg-faint"
                  >
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

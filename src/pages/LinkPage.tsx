import { useMemo, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, AudioLines, Check, Clapperboard, Construction, Link2, RotateCw } from "lucide-react";
import { detectLink, LINK_LABELS } from "../lib/links";
import { api, type AudioFormat, type DownloadOptions, type MediaInfo, type Settings } from "../lib/ipc";
import { DownloadOptionsPanel } from "../components/DownloadOptionsPanel";
import { formatBytes, formatCount, formatDuration, formatRelative, parseYmd } from "../lib/format";
import { errorMessage, useSettings } from "../hooks/useSettings";
import { EmptyState } from "../components/ui/EmptyState";
import { SmartLinkInput } from "../components/SmartLinkInput";
import { Segmented } from "../components/ui/Segmented";
import { Button } from "../components/ui/Button";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";
import { cn } from "../lib/cn";
import { PlaylistLink } from "./PlaylistLink";

const route = getRouteApi("/link");

export function LinkPage() {
  const { url } = route.useSearch();
  if (!url) {
    return (
      <div className="mx-auto max-w-[720px] pt-[8vh]">
        <EmptyState icon={Link2} title="Paste a link to get started">
          YouTube videos and playlists, Spotify songs, albums and playlists, and links from 1000+ other sites.
        </EmptyState>
        <SmartLinkInput variant="hero" autoFocus />
      </div>
    );
  }
  const d = detectLink(url);
  if (d.kind.startsWith("spotify")) {
    return (
      <div className="mx-auto max-w-[720px]">
        <EmptyState icon={Construction} title={`${LINK_LABELS[d.kind]}s are coming soon`}>
          Importing from Spotify arrives in milestone M3.
        </EmptyState>
      </div>
    );
  }
  if (d.kind === "youtube-playlist" || d.kind === "youtube-channel") {
    return <PlaylistLink key={d.url ?? url} url={d.url ?? url} />;
  }
  return <VideoLink key={d.url ?? url} url={d.url ?? url} />;
}

function Skeleton() {
  return (
    <div className="animate-pulse" aria-busy aria-label="Loading video details">
      <div className="flex gap-5">
        <div className="aspect-video w-72 shrink-0 rounded-lg bg-surface-2" />
        <div className="flex flex-1 flex-col gap-3 pt-1">
          <div className="h-5 w-11/12 rounded bg-surface-2" />
          <div className="h-5 w-7/12 rounded bg-surface-2" />
          <div className="mt-2 h-4 w-5/12 rounded bg-surface-2" />
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

function VideoLink({ url }: { url: string }) {
  const info = useQuery({ queryKey: ["info", url], queryFn: () => api.fetchInfo(url), staleTime: 10 * 60_000, retry: false });
  const settings = useSettings();

  return (
    <div className="mx-auto max-w-[860px]">
      {info.isPending && <Skeleton />}
      {info.isError && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface-1 px-6 py-12 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-warning">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <h2 className="font-semibold">Couldn't open this link</h2>
          <p className="selectable max-w-md text-muted">{errorMessage(info.error)}</p>
          <p className="selectable max-w-md truncate font-mono text-[12px] text-faint">{url}</p>
          <Button icon={<RotateCw />} onClick={() => info.refetch()} loading={info.isFetching}>
            Try again
          </Button>
        </div>
      )}
      {info.data && settings.data && <Preview info={info.data} settings={settings.data} />}
    </div>
  );
}

function Preview({ info, settings }: { info: MediaInfo; settings: Settings }) {
  const uploaded = parseYmd(info.uploadDate);
  const meta = [
    info.channel,
    formatDuration(info.duration),
    info.viewCount != null ? `${formatCount(info.viewCount)} views` : null,
    uploaded ? formatRelative(uploaded) : null,
  ].filter(Boolean);

  return (
    <>
      <div className="flex gap-5">
        <div className="relative aspect-video w-72 shrink-0 overflow-hidden rounded-lg bg-surface-2">
          {info.thumbnail && <img src={info.thumbnail} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />}
          {info.duration != null && (
            <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[12px] font-medium text-white tabular">
              {formatDuration(info.duration)}
            </span>
          )}
        </div>
        <div className="min-w-0 pt-1">
          <span className="text-[12px] font-medium tracking-[0.06em] text-faint uppercase">{info.site}</span>
          <h1 className="selectable mt-1 line-clamp-3 text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">{info.title}</h1>
          <p className="mt-2 text-muted">{meta.join(" · ")}</p>
        </div>
      </div>
      <FormatPicker info={info} settings={settings} />
    </>
  );
}

function defaultHeight(info: MediaInfo, pref: string): string {
  if (!info.video.length) return "";
  if (pref === "best") return String(info.video[0]!.height);
  const max = Number(pref);
  const fit = info.video.find((v) => v.height <= max);
  return String((fit ?? info.video[info.video.length - 1]!).height);
}

function FormatPicker({ info, settings }: { info: MediaInfo; settings: Settings }) {
  const hasVideo = info.video.length > 0;
  const [kind, setKind] = useState<"video" | "audio">(hasVideo ? "video" : "audio");
  const [height, setHeight] = useState(() => defaultHeight(info, settings.videoQuality));
  const [audio, setAudio] = useState<AudioFormat>(() =>
    info.audio.some((a) => a.id === settings.audioFormat) ? settings.audioFormat : (info.audio[0]?.id ?? "opus"),
  );
  const [options, setOptions] = useState<DownloadOptions>(() => ({
    // Pre-select subtitles in the languages chosen in Settings, e.g. "en" matches "en" and "en-orig".
    subtitles: info.subtitles
      .filter((s) => settings.subtitleLangs.some((l) => s.code === l || s.code.startsWith(`${l}-`)))
      .map((s) => s.code),
    subtitleMode: "embed",
    section: null,
    sponsorblock: info.site.toLowerCase().startsWith("youtube") ? settings.sponsorblock : "off",
    splitChapters: false,
  }));
  const [sectionError, setSectionError] = useState<string | null>(null);

  // "Added" applies only to the exact choice that was queued; changing the choice resets it.
  const choiceKey = `${kind}|${height}|${audio}|${JSON.stringify(options)}`;
  const [addedKey, setAddedKey] = useState<string | null>(null);
  const added = addedKey === choiceKey;

  const enqueue = useMutation({
    mutationFn: () =>
      api.enqueueDownload({
        url: info.url,
        title: info.title,
        thumbnail: info.thumbnail,
        kind,
        quality: kind === "video" ? height : "best",
        audioFormat: audio,
        options: { ...options, subtitles: kind === "video" ? options.subtitles : [] },
        duration: options.section ? options.section.end - options.section.start : info.duration,
      }),
    onSuccess: () => {
      setAddedKey(choiceKey);
      // Show the activity panel the first time, so people learn where downloads go.
      let introduced = false;
      try {
        introduced = localStorage.getItem("grab.activityIntro") === "1";
        localStorage.setItem("grab.activityIntro", "1");
      } catch {
        /* storage unavailable */
      }
      if (!introduced) useUi.getState().setActivityOpen(true);
      toast.success("Added to downloads", { label: "Show", run: () => useUi.getState().setActivityOpen(true) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const selectedSize = useMemo(() => {
    if (kind === "video") return info.video.find((v) => String(v.height) === height)?.size ?? null;
    return info.audio.find((a) => a.id === audio)?.size ?? null;
  }, [kind, height, audio, info]);

  return (
    <section className="mt-8 rounded-lg border border-line bg-surface-1">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <Segmented<"video" | "audio">
          label="Download type"
          value={kind}
          onChange={setKind}
          options={[
            ...(hasVideo ? [{ value: "video" as const, label: "Video", icon: Clapperboard }] : []),
            { value: "audio" as const, label: "Audio only", icon: AudioLines },
          ]}
        />
        <span className="text-[13px] text-muted">
          Saves to {kind === "video" ? "Videos" : "Music"} › Grab
        </span>
      </div>

      <div role="radiogroup" aria-label={kind === "video" ? "Video quality" : "Audio format"} className="flex flex-col p-2">
        {kind === "video"
          ? info.video.map((v) => {
              const id = String(v.height);
              const tags = [v.height >= 4320 ? "8K" : v.height >= 2160 ? "4K" : null, v.hdr ? "HDR" : null].filter(Boolean) as string[];
              return (
                <OptionRow
                  key={id}
                  checked={height === id}
                  onSelect={() => setHeight(id)}
                  title={v.label}
                  tags={tags}
                  detail={[v.fps && v.fps > 30 ? `${v.fps} fps` : null, v.codec].filter(Boolean).join(" · ")}
                  size={v.size}
                />
              );
            })
          : info.audio.map((a) => (
              <OptionRow key={a.id} checked={audio === a.id} onSelect={() => setAudio(a.id)} title={a.label} detail={a.detail} size={a.size} />
            ))}
      </div>

      <DownloadOptionsPanel info={info} kind={kind} value={options} onChange={setOptions} onSectionError={setSectionError} />

      <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-4">
        <span className={cn("text-[13px]", sectionError ? "text-danger" : "text-muted")}>
          {sectionError ??
            (options.section
              ? `Part ${formatDuration(options.section.start)}–${formatDuration(options.section.end)}`
              : selectedSize
                ? `About ${formatBytes(selectedSize)}`
                : "Size unknown")}
          {!sectionError && kind === "video" && " · MP4 when possible"}
        </span>
        <Button
          variant="primary"
          size="lg"
          icon={added ? <Check /> : <ArrowDownToLine />}
          loading={enqueue.isPending}
          onClick={() => enqueue.mutate()}
          disabled={(kind === "video" && !height) || sectionError !== null}
        >
          {added ? "Added · download again" : "Download"}
        </Button>
      </div>
    </section>
  );
}

function OptionRow({
  checked,
  onSelect,
  title,
  tags = [],
  detail,
  size,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  tags?: string[];
  detail?: string;
  size: number | null;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-4 rounded-md px-3 py-3 text-left transition-colors",
        checked ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded-full border-2",
          checked ? "border-accent" : "border-faint",
        )}
        aria-hidden
      >
        {checked && <span className="size-2 rounded-full bg-accent" />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="font-semibold">{title}</span>
        {tags.map((t) => (
          <span key={t} className="rounded border border-current px-1 text-[10.5px] leading-4 font-semibold text-accent">
            {t}
          </span>
        ))}
        {detail && <span className="truncate text-[13px] text-muted">{detail}</span>}
      </span>
      <span className="shrink-0 text-[13px] text-muted tabular">{size ? `~${formatBytes(size)}` : ""}</span>
    </button>
  );
}

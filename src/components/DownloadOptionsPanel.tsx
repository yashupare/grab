import { useState } from "react";
import { ChevronDown, Captions, ListTree, Scissors, ShieldOff } from "lucide-react";
import type { DownloadOptions, MediaInfo, SponsorBlock } from "../lib/ipc";
import { formatDuration, parseTime } from "../lib/format";
import { Segmented } from "./ui/Segmented";
import { Switch } from "./ui/Switch";
import { cn } from "../lib/cn";

/** Count of options that differ from "download the whole thing, no extras". */
export function activeOptionCount(o: DownloadOptions, kind: "video" | "audio") {
  return (
    (kind === "video" && o.subtitles.length ? 1 : 0) + (o.section ? 1 : 0) + (o.sponsorblock !== "off" ? 1 : 0) + (o.splitChapters ? 1 : 0)
  );
}

function Block({ icon: Icon, title, hint, children }: { icon: typeof Captions; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-line py-4 first:border-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
        <div className="mt-2.5">{children}</div>
      </div>
    </div>
  );
}

export function DownloadOptionsPanel({
  info,
  kind,
  value,
  onChange,
  onSectionError,
}: {
  info: MediaInfo;
  kind: "video" | "audio";
  value: DownloadOptions;
  onChange: (o: DownloadOptions) => void;
  onSectionError: (error: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [showAllSubs, setShowAllSubs] = useState(false);
  const isYouTube = info.site.toLowerCase().startsWith("youtube");
  const count = activeOptionCount(value, kind);

  function updateSection(s: string, e: string) {
    setStart(s);
    setEnd(e);
    if (!s.trim() && !e.trim()) {
      onSectionError(null);
      onChange({ ...value, section: null });
      return;
    }
    const a = s.trim() ? parseTime(s) : 0;
    const b = e.trim() ? parseTime(e) : (info.duration ?? null);
    let error: string | null = null;
    if (a == null || b == null) error = "Use a time like 1:30 or 1:02:05.";
    else if (b <= a) error = "The end must be after the start.";
    else if (info.duration && b > info.duration + 1) error = `The video is only ${formatDuration(info.duration)} long.`;
    onSectionError(error);
    if (!error && a != null && b != null) onChange({ ...value, section: { start: a, end: b } });
  }

  function toggleSub(code: string) {
    const has = value.subtitles.includes(code);
    onChange({ ...value, subtitles: has ? value.subtitles.filter((c) => c !== code) : [...value.subtitles, code] });
  }

  const subs = showAllSubs ? info.subtitles : info.subtitles.slice(0, 12);

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3 text-left font-medium text-muted hover:text-fg"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        More options
        {count > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent">{count}</span>}
      </button>

      {open && (
        <div className="px-5 pb-2">
          {kind === "video" && info.subtitles.length > 0 && (
            <Block icon={Captions} title="Subtitles" hint="Pick the languages to include.">
              <div className="flex flex-wrap gap-1.5">
                {subs.map((s) => {
                  const on = value.subtitles.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSub(s.code)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[13px] transition-colors",
                        on ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:border-muted hover:text-fg",
                      )}
                    >
                      {s.name}
                    </button>
                  );
                })}
                {info.subtitles.length > 12 && !showAllSubs && (
                  <button type="button" className="px-2 text-[13px] text-accent" onClick={() => setShowAllSubs(true)}>
                    +{info.subtitles.length - 12} more
                  </button>
                )}
              </div>
              {value.subtitles.length > 0 && (
                <div className="mt-3">
                  <Segmented<"embed" | "file">
                    label="Subtitle format"
                    value={value.subtitleMode}
                    onChange={(subtitleMode) => onChange({ ...value, subtitleMode })}
                    options={[
                      { value: "embed", label: "Inside the video", title: "Switch subtitles on and off in your player" },
                      { value: "file", label: "Separate .srt file" },
                    ]}
                  />
                </div>
              )}
            </Block>
          )}

          <Block icon={Scissors} title="Only download part" hint="Leave empty for the whole thing. Cuts can be a second or two off.">
            <div className="flex items-center gap-2">
              <TimeInput label="Start" value={start} placeholder="0:00" onChange={(v) => updateSection(v, end)} />
              <span className="text-faint">to</span>
              <TimeInput label="End" value={end} placeholder={formatDuration(info.duration) || "end"} onChange={(v) => updateSection(start, v)} />
            </div>
          </Block>

          {isYouTube && (
            <Block icon={ShieldOff} title="Sponsor segments" hint="Uses SponsorBlock, where viewers mark sponsor reads. Works on videos people have marked.">
              <Segmented<SponsorBlock>
                label="Sponsor segments"
                value={value.sponsorblock}
                onChange={(sponsorblock) => onChange({ ...value, sponsorblock })}
                options={[
                  { value: "off", label: "Keep" },
                  { value: "remove", label: "Remove" },
                  { value: "mark", label: "Mark as chapters" },
                ]}
              />
            </Block>
          )}

          {info.chapters > 0 && (
            <Block icon={ListTree} title="Split by chapters" hint={`Also save each of the ${info.chapters} chapters as its own file.`}>
              <Switch label="Split by chapters" checked={value.splitChapters} onChange={(splitChapters) => onChange({ ...value, splitChapters })} />
            </Block>
          )}
        </div>
      )}
    </div>
  );
}

function TimeInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      inputMode="numeric"
      className="h-9 w-24 rounded-md border border-line bg-surface-2 px-3 text-center font-mono text-[13px] outline-none placeholder:text-faint focus:border-muted"
    />
  );
}

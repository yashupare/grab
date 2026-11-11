import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, Disc3, Layers, Scissors, type LucideIcon } from "lucide-react";
import { SmartLinkInput } from "../components/SmartLinkInput";

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface QuickAction {
  label: string;
  description: string;
  icon: LucideIcon;
  to: "/link" | "/tools" | "/music";
}

const QUICK: QuickAction[] = [
  { label: "Download a video", description: "YouTube and 1000+ sites, up to 8K", icon: ArrowDownToLine, to: "/link" },
  { label: "Spotify → music", description: "Save songs with names and cover art", icon: Disc3, to: "/link" },
  { label: "Merge videos", description: "Join clips into one file", icon: Layers, to: "/tools" },
  { label: "Trim & compress", description: "Cut a part, shrink for WhatsApp", icon: Scissors, to: "/tools" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[13px] font-medium tracking-[0.06em] text-faint uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function HomePage() {
  return (
    <div className="mx-auto max-w-[880px] pt-[6vh]">
      <h1 className="text-[40px] leading-[44px] font-bold tracking-[-0.03em]">{greeting()}</h1>
      <p className="mt-2 mb-7 text-[15px] text-muted">Paste a link to download it, or pick something to do.</p>

      <SmartLinkInput variant="hero" autoFocus />
      <p className="mt-3 text-[13px] text-faint">
        Works with YouTube, YouTube Music, Spotify and 1000+ other sites. You can also paste anywhere in the app.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {QUICK.map(({ label, description, icon: Icon, to }) => (
          <Link
            key={label}
            to={to}
            search={to === "/link" ? { url: "" } : to === "/music" ? { q: "" } : undefined}
            className="group flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-muted"
          >
            <div className="grid size-9 place-items-center rounded-md bg-accent-soft text-accent">
              <Icon className="size-[18px]" aria-hidden />
            </div>
            <div>
              <div className="font-semibold">{label}</div>
              <div className="mt-0.5 text-[13px] text-muted">{description}</div>
            </div>
          </Link>
        ))}
      </div>

      <Section title="In progress">
        <div className="rounded-lg border border-dashed border-line px-5 py-6 text-center text-muted">
          Nothing downloading. Paste a link above to start.
        </div>
      </Section>
    </div>
  );
}

import type { GraphStats } from "@/lib/graphLoader";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
    </div>
  );
}

/** Node/link/community counts plus the short build commit (em-dash when absent). */
export default function StatsBar({ stats }: { stats: GraphStats }) {
  return (
    <div className="flex items-center gap-6">
      <Stat label="nodes" value={stats.nodes} />
      <Stat label="links" value={stats.links} />
      <Stat label="communities" value={stats.communities} />
      <Stat label="commit" value={stats.commit || "—"} />
    </div>
  );
}

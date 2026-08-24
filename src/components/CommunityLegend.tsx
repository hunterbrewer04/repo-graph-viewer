import { COMMUNITY_PALETTE, paletteForCommunity } from "@/lib/graphLoader";

export interface LegendEntry {
  community: number;
  name: string;
  count: number;
}

/**
 * Communities sorted by size desc, capped at the 16 palette hues (loader wraps
 * ids modulo the palette, so entries beyond that repeat colors and would lie).
 */
export default function CommunityLegend({ entries }: { entries: LegendEntry[] }) {
  const visible = entries.slice(0, COMMUNITY_PALETTE.length);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface/90 p-2 backdrop-blur">
      {visible.map(({ community, name, count }) => (
        <div key={community} className="flex items-center gap-2 text-[10px]">
          <span
            aria-hidden
            title={name}
            className="size-2 shrink-0 rounded-full"
            style={{
              background: paletteForCommunity(community),
              boxShadow: `0 0 6px ${paletteForCommunity(community)}`,
            }}
          />
          <span className="max-w-[11rem] truncate text-muted" title={name}>
            {name}
          </span>
          <span className="ml-auto font-mono text-foreground/70">{count}</span>
        </div>
      ))}
      {entries.length > visible.length && (
        <div className="text-[10px] text-muted">
          +{entries.length - visible.length} more communities
        </div>
      )}
    </div>
  );
}

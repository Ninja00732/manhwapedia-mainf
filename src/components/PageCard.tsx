import { Link } from "@tanstack/react-router";

export interface PageCardData {
  slug: string;
  title: string;
  cover_url: string | null;
  type: "series" | "character" | "lore";
  status?: string | null;
  updated_at?: string;
}

export function PageCard({ p }: { p: PageCardData }) {
  return (
    <Link
      to="/wiki/$slug"
      params={{ slug: p.slug }}
      className="group block rounded-lg overflow-hidden border border-border bg-card hover:border-primary transition-colors"
    >
      <div className="aspect-[3/4] bg-surface-2 overflow-hidden">
        {p.cover_url ? (
          <img
            src={p.cover_url}
            alt={p.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-muted-foreground text-sm">
            Sem capa
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-xs uppercase tracking-wider text-primary/80 mb-0.5">{p.type === "series" ? "Série" : p.type === "character" ? "Personagem" : "Lore"}</div>
        <div className="font-display font-semibold leading-tight line-clamp-2 group-hover:text-primary">{p.title}</div>
      </div>
    </Link>
  );
}

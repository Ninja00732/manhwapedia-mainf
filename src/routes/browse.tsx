import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { PageCard } from "@/components/PageCard";

const searchSchema = z.object({
  type: fallback(z.enum(["all", "series", "lore"]), "all").default("all"),
  status: fallback(z.enum(["all", "ongoing", "completed", "hiatus", "cancelled", "unknown"]), "all").default("all"),
  tag: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/browse")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Catálogo — ManhwaPedia" },
      { name: "description", content: "Navegue por todas as séries, personagens e páginas de lore criadas na ManhwaPedia." },
    ],
  }),
  component: Browse,
});

function Browse() {
  const { type, status, tag } = Route.useSearch();

  const tagsQ = useQuery({
    queryKey: ["all-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("slug,name,kind").order("name");
      return data ?? [];
    },
  });

  const pagesQ = useQuery({
    queryKey: ["browse", { type, status, tag }],
    queryFn: async () => {
      let query = supabase.from("wiki_pages").select("slug,title,cover_url,type,status,updated_at,page_tags(tag_id,tags(slug))").order("updated_at", { ascending: false }).limit(60);
      if (type !== "all") query = query.eq("type", type);
      else query = query.neq("type", "character");
      if (status !== "all") query = query.eq("status", status as any);
      const { data, error } = await query;
      if (error) throw error;
      if (tag) {
        return (data ?? []).filter((p: any) => p.page_tags?.some((pt: any) => pt.tags?.slug === tag));
      }
      return data ?? [];
    },
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl md:text-4xl font-bold mb-6">Catálogo</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-8 pb-6 border-b border-border">
        <FilterGroup label="Tipo">
          {[
            { v: "all", n: "Todos" },
            { v: "series", n: "Séries" },
            { v: "lore", n: "Lore" },
          ].map((o) => (
            <FilterChip key={o.v} to="/browse" search={(s: any) => ({ ...s, type: o.v })} active={type === o.v}>
              {o.n}
            </FilterChip>
          ))}
        </FilterGroup>
        <FilterGroup label="Status">
          {[
            { v: "all", n: "Todos" },
            { v: "ongoing", n: "Em andamento" },
            { v: "completed", n: "Concluído" },
            { v: "hiatus", n: "Em hiato" },
          ].map((o) => (
            <FilterChip key={o.v} to="/browse" search={(s: any) => ({ ...s, status: o.v })} active={status === o.v}>
              {o.n}
            </FilterChip>
          ))}
        </FilterGroup>
      </div>

      {/* Tag cloud */}
      {tagsQ.data && (
        <div className="mb-8">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Tags & Gêneros</div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip to="/browse" search={(s: any) => ({ ...s, tag: "" })} active={!tag}>Todas</FilterChip>
            {tagsQ.data.map((t) => (
              <FilterChip key={t.slug} to="/browse" search={(s: any) => ({ ...s, tag: t.slug })} active={tag === t.slug}>
                {t.name}
              </FilterChip>
            ))}
          </div>
        </div>
      )}

      {pagesQ.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-lg bg-surface animate-pulse" />
          ))}
        </div>
      ) : (pagesQ.data ?? []).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          Nenhuma página encontrada com esses filtros.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {(pagesQ.data ?? []).map((p: any) => (
            <PageCard key={p.slug} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({ to, search, active, children }: any) {
  return (
    <Link
      to={to}
      search={search}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-surface border-border hover:border-primary"
      }`}
    >
      {children}
    </Link>
  );
}

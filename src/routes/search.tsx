import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/search")({
  validateSearch: zodValidator(schema),
  head: () => ({ meta: [{ title: "Buscar — ManhwaPedia" }] }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const results = useQuery({
    queryKey: ["search", q],
    enabled: q.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_pages")
        .select("slug,title,type,cover_url,parent_slug")
        .ilike("title", `%${q}%`)
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="font-display text-3xl font-bold mb-1">Resultados</h1>
      <p className="text-muted-foreground mb-8">para "{q}"</p>

      {!q && <p className="text-muted-foreground">Digite algo na busca.</p>}
      {q && results.isLoading && <p className="text-muted-foreground">Buscando…</p>}
      {q && results.data && results.data.length === 0 && (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <p className="text-muted-foreground mb-3">Nada encontrado.</p>
          <Link to="/create" search={{ title: q }} className="text-primary hover:underline">
            Que tal criar a página "{q}"?
          </Link>
        </div>
      )}
      <ul className="divide-y divide-border">
        {(results.data ?? []).map((p) => (
          <li key={p.slug}>
            <Link to="/wiki/$slug" params={{ slug: p.slug }} className="flex items-center gap-4 py-3 hover:bg-muted rounded px-2">
              <div className="w-10 h-14 rounded bg-surface-2 overflow-hidden shrink-0">
                {p.cover_url && <img src={p.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0">
                <div className="font-medium">{p.title}</div>
                <div className="text-xs text-muted-foreground">
                  {p.type === "series" ? "Série" : p.type === "character" ? "Personagem" : "Lore"}
                  {p.parent_slug ? ` • ${p.parent_slug}` : ""}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

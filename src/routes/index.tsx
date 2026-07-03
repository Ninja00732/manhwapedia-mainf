import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageCard } from "@/components/PageCard";
import { TrendingUp, Clock, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ManhwaPedia — wiki colaborativa de manhwa, mangá e webtoon" },
      { name: "description", content: "Descubra sinopses, personagens e lore de suas séries favoritas. Colabore editando páginas como em uma wiki." },
    ],
  }),
  component: Home,
});

function Home() {
  const featured = useQuery({
    queryKey: ["home", "featured"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_pages")
        .select("slug,title,cover_url,type,status,updated_at")
        .eq("type", "series")
        .not("cover_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data;
    },
  });

  const recent = useQuery({
    queryKey: ["home", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_pages")
        .select("slug,title,cover_url,type,updated_at")
        .neq("type", "character")
        .order("updated_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-surface via-background to-background">
        <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-primary mb-4">
              <Sparkles className="w-3.5 h-3.5" /> Wiki colaborativa
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight">
              A enciclopédia de <span className="text-primary">manhwa</span>, mangá e webtoon escrita pela comunidade.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-2xl">
              Crie e edite páginas de séries, personagens e lore. Cada alteração vira uma revisão — igual ao Wikipedia, mas para as histórias que a gente ama.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/browse" className="inline-flex items-center h-11 px-5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90">
                Explorar catálogo
              </Link>
              <Link to="/create" className="inline-flex items-center h-11 px-5 rounded-md border border-border hover:border-primary">
                Criar nova página
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Featured */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex items-end justify-between mb-6">
          <h2 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Séries em destaque
          </h2>
          <Link to="/browse" className="text-sm text-muted-foreground hover:text-primary">Ver tudo →</Link>
        </div>
        {featured.isLoading ? (
          <SkeletonGrid />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {(featured.data ?? []).map((p) => (
              <PageCard key={p.slug} p={p as any} />
            ))}
          </div>
        )}
      </section>

      {/* Recent edits */}
      <section className="max-w-7xl mx-auto px-4 py-6 pb-16">
        <div className="flex items-end justify-between mb-6">
          <h2 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" /> Editadas recentemente
          </h2>
        </div>
        {recent.isLoading ? (
          <SkeletonGrid />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {(recent.data ?? []).map((p) => (
              <li key={p.slug}>
                <Link
                  to="/wiki/$slug"
                  params={{ slug: p.slug }}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors"
                >
                  <div className="w-10 h-14 rounded bg-surface-2 overflow-hidden shrink-0">
                    {p.cover_url && <img src={p.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.type === "series" ? "Série" : p.type === "character" ? "Personagem" : "Lore"} • atualizada em {new Date(p.updated_at).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-[3/4] rounded-lg bg-surface animate-pulse" />
      ))}
    </div>
  );
}

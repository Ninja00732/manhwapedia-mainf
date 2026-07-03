import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageCard } from "@/components/PageCard";

export const Route = createFileRoute("/watchlist")({
  head: () => ({ meta: [{ title: "Minha watchlist — ManhwaPedia" }] }),
  component: WatchlistPage,
});

function WatchlistPage() {
  const { user, loading } = useAuth();

  const { data } = useQuery({
    queryKey: ["watchlist", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("watchlist")
        .select("wiki_pages(slug,title,cover_url,type,status,updated_at)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return (data ?? []).map((w: any) => w.wiki_pages).filter(Boolean);
    },
  });

  if (loading) return null;
  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="mb-4">Entre para ver sua watchlist.</p>
        <Link to="/auth" className="inline-flex items-center h-10 px-4 rounded-md bg-primary text-primary-foreground">Entrar</Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl font-bold mb-6">Minha watchlist</h1>
      {(data ?? []).length === 0 ? (
        <p className="text-muted-foreground">Sua watchlist está vazia. Use o botão "Observar" em uma página para adicioná-la.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {(data ?? []).map((p: any) => <PageCard key={p.slug} p={p} />)}
        </div>
      )}
    </div>
  );
}

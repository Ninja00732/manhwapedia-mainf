import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/moderation")({
  head: () => ({ meta: [{ title: "Moderação — ManhwaPedia" }] }),
  component: ModPage,
});

function ModPage() {
  const { user, isMod, loading } = useAuth();
  const qc = useQueryClient();

  const { data: reports } = useQuery({
    queryKey: ["reports"],
    enabled: !!isMod,
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("id,reason,status,created_at,page_id,wiki_pages!page_id(slug,title),profiles:reporter_id(username)")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "resolved" | "dismissed" }) => {
      const { error } = await supabase.from("reports").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
    onError: (e: any) => toast.error(e.message),
  });

  if (loading) return null;
  if (!user || !isMod) {
    return (
      <div className="max-w-md mx-auto p-16 text-center">
        <p className="mb-2 font-medium">Acesso restrito.</p>
        <p className="text-sm text-muted-foreground">Apenas moderadores e administradores.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="font-display text-3xl font-bold mb-6">Fila de moderação</h1>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {(reports ?? []).map((r: any) => (
          <li key={r.id} className="p-4 flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "open" ? "bg-destructive/20 text-destructive" : "bg-surface-2 text-muted-foreground"}`}>
                  {r.status}
                </span>
                {r.wiki_pages && (
                  <Link to="/wiki/$slug" params={{ slug: r.wiki_pages.slug }} className="font-medium hover:text-primary">
                    {r.wiki_pages.title}
                  </Link>
                )}
              </div>
              <p className="text-sm">"{r.reason}"</p>
              <p className="text-xs text-muted-foreground mt-1">
                por @{r.profiles?.username ?? "?"} • {formatDate(r.created_at)}
              </p>
            </div>
            {r.status === "open" && (
              <div className="flex gap-2">
                <button onClick={() => setStatus.mutate({ id: r.id, status: "dismissed" })} className="h-8 px-3 rounded-md border border-border text-xs">
                  Descartar
                </button>
                <button onClick={() => setStatus.mutate({ id: r.id, status: "resolved" })} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs">
                  Resolver
                </button>
              </div>
            )}
          </li>
        ))}
        {(reports ?? []).length === 0 && <li className="p-6 text-sm text-muted-foreground text-center">Sem denúncias por enquanto. 🎉</li>}
      </ul>

      <div className="mt-8 p-4 rounded-lg border border-border bg-surface text-sm text-muted-foreground">
        <strong>Dica:</strong> para reverter edições ruins, abra a aba <em>Histórico</em> da página e use o botão "Reverter".
      </div>
    </div>
  );
}

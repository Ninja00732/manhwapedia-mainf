import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageTabs } from "@/components/PageTabs";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { RotateCcw, Eye } from "lucide-react";

export const Route = createFileRoute("/wiki/$slug/history")({
  head: ({ params }) => ({ meta: [{ title: `Histórico de ${params.slug} — ManhwaPedia` }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: page } = useQuery({
    queryKey: ["wiki", slug],
    queryFn: async () => {
      const { data } = await supabase.from("wiki_pages").select("id,title,type").eq("slug", slug).maybeSingle();
      return data;
    },
  });

  const { data: revs, isLoading } = useQuery({
    queryKey: ["revisions", slug],
    enabled: !!page,
    queryFn: async () => {
      const { data } = await supabase
        .from("revisions")
        .select("id, created_at, comment, editor_id, title, profiles:editor_id(username, display_name)")
        .eq("page_id", page!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const revert = useMutation({
    mutationFn: async (revId: string) => {
      if (!user || !page) throw new Error("Login necessário");
      const { data: rev } = await supabase.from("revisions").select("*").eq("id", revId).maybeSingle();
      if (!rev) throw new Error("Revisão não encontrada");
      const { error } = await supabase.from("wiki_pages").update({
        title: rev.title,
        cover_url: rev.cover_url,
        content_md: rev.content_md,
        infobox: rev.infobox,
        status: rev.status,
        parent_slug: rev.parent_slug,
        updated_by: user.id,
      }).eq("id", page.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Revertido para a revisão selecionada");
      qc.invalidateQueries({ queryKey: ["revisions", slug] });
      qc.invalidateQueries({ queryKey: ["wiki", slug] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!page) return null;

  return (
    <div>
      <PageTabs slug={slug} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-bold mb-1">Histórico de "{page.title}"</h1>
        <p className="text-sm text-muted-foreground mb-6">Toda edição gera uma revisão. Você pode ver ou reverter para qualquer versão anterior.</p>

        {isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border bg-card">
            {(revs ?? []).map((r: any, i) => (
              <li key={r.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {r.profiles?.display_name || r.profiles?.username || "Sistema"}
                    <span className="text-muted-foreground font-normal"> • {formatDate(r.created_at)}</span>
                    {i === 0 && <span className="ml-2 text-xs text-primary">(atual)</span>}
                  </div>
                  {r.comment && <div className="text-sm text-muted-foreground mt-0.5">"{r.comment}"</div>}
                </div>
                <Link
                  to="/wiki/$slug/revisions/$revId"
                  params={{ slug, revId: r.id }}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border hover:border-primary text-xs"
                >
                  <Eye className="w-3.5 h-3.5" /> Ver
                </Link>
                {user && i !== 0 && (
                  <button
                    onClick={() => confirm("Reverter para esta revisão?") && revert.mutate(r.id)}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border hover:border-destructive text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reverter
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

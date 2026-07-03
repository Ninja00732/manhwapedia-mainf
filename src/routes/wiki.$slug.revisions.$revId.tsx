import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Markdown } from "@/components/Markdown";
import { PageTabs } from "@/components/PageTabs";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/wiki/$slug/revisions/$revId")({
  component: RevisionView,
});

function RevisionView() {
  const { slug, revId } = Route.useParams();
  const { data: rev } = useQuery({
    queryKey: ["rev", revId],
    queryFn: async () => {
      const { data } = await supabase
        .from("revisions")
        .select("*, profiles:editor_id(username, display_name)")
        .eq("id", revId)
        .maybeSingle();
      return data;
    },
  });

  if (!rev) return <div className="max-w-3xl mx-auto p-8 text-muted-foreground">Carregando…</div>;

  return (
    <div>
      <PageTabs slug={slug} />
      <article className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-4 p-3 rounded-md border border-primary/50 bg-primary/10 text-sm">
          Visualizando revisão de {formatDate(rev.created_at)} por{" "}
          <strong>{(rev as any).profiles?.display_name ?? (rev as any).profiles?.username ?? "Sistema"}</strong>.{" "}
          <Link to="/wiki/$slug/history" params={{ slug }} className="text-primary hover:underline">Voltar ao histórico</Link>
        </div>
        <h1 className="font-display text-3xl font-bold mb-4">{rev.title}</h1>
        <Markdown>{rev.content_md}</Markdown>
      </article>
    </div>
  );
}

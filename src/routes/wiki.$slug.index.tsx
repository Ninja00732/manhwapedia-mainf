import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Infobox } from "@/components/Infobox";
import { Markdown } from "@/components/Markdown";
import { PageTabs } from "@/components/PageTabs";
import { useAuth } from "@/lib/auth";
import { Bookmark, BookmarkCheck, Flag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/wiki/$slug/")({
  loader: async ({ params, context }) => {
    await context.queryClient.prefetchQuery({
      queryKey: ["wiki", params.slug],
      queryFn: () => fetchPage(params.slug),
    });
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — ManhwaPedia` },
      { name: "description", content: `Página wiki sobre ${params.slug} na ManhwaPedia.` },
    ],
  }),
  component: WikiPage,
});

async function fetchPage(slug: string) {
  const { data, error } = await supabase
    .from("wiki_pages")
    .select("*, page_tags(tag_id, tags(slug,name))")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function WikiPage() {
  const { slug } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: page, isLoading } = useQuery({
    queryKey: ["wiki", slug],
    queryFn: () => fetchPage(slug),
  });

  const children = useQuery({
    queryKey: ["wiki-children", slug],
    enabled: !!page && page.type === "series",
    queryFn: async () => {
      const { data } = await supabase
        .from("wiki_pages")
        .select("slug,title,type,cover_url")
        .eq("parent_slug", slug)
        .order("title");
      return data ?? [];
    },
  });

  const isWatched = useQuery({
    queryKey: ["watch", slug, user?.id],
    enabled: !!user && !!page,
    queryFn: async () => {
      const { data } = await supabase.from("watchlist").select("page_id").eq("user_id", user!.id).eq("page_id", page!.id).maybeSingle();
      return !!data;
    },
  });

  const toggleWatch = useMutation({
    mutationFn: async () => {
      if (!user || !page) throw new Error("Login necessário");
      if (isWatched.data) {
        await supabase.from("watchlist").delete().eq("user_id", user.id).eq("page_id", page.id);
      } else {
        await supabase.from("watchlist").insert({ user_id: user.id, page_id: page.id });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watch", slug] }),
  });

  const deletePage = useMutation({
    mutationFn: async () => {
      if (!user || !page) throw new Error("Login necessário");
      const confirmed = window.confirm(`Tem certeza que deseja apagar "${page.title}"?`);
      if (!confirmed) return;
      const { error } = await supabase.from("wiki_pages").delete().eq("id", page.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Página apagada com sucesso.");
      navigate({ to: "/" });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao apagar a página"),
  });

  if (isLoading) return <div className="max-w-7xl mx-auto px-4 py-12 text-muted-foreground">Carregando…</div>;
  if (!page) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-4xl font-bold mb-3">"{slug}"</h1>
        <p className="text-muted-foreground mb-6">Essa página ainda não existe. Que tal criá-la?</p>
        <Link
          to="/create"
          search={{ title: slug.replace(/-/g, " ") }}
          className="inline-flex items-center h-10 px-4 rounded-md bg-primary text-primary-foreground font-medium"
        >
          Criar página "{slug}"
        </Link>
      </div>
    );
  }

  const tags = (page.page_tags ?? []).map((pt: any) => pt.tags).filter(Boolean);
  const canDeletePage = Boolean(user && (isAdmin || page.created_by === user.id));

  return (
    <div>
      <PageTabs slug={slug} />
      <article className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-primary mb-1">
              {page.type === "series" ? "Série" : page.type === "character" ? "Personagem" : "Lore"}
            </div>
            <h1 className="font-display text-3xl md:text-5xl font-bold leading-tight">{page.title}</h1>
          </div>
          {user && (
            <>
              <button
                onClick={() => toggleWatch.mutate()}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border hover:border-primary text-sm"
              >
                {isWatched.data ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
                {isWatched.data ? "Observando" : "Observar"}
              </button>
              <ReportButton pageId={page.id} />
              {canDeletePage && (
                <button
                  onClick={() => deletePage.mutate()}
                  disabled={deletePage.isPending}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 text-sm disabled:opacity-50"
                >
                  {deletePage.isPending ? "Apagando…" : "Apagar"}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          <Infobox
            title={page.title}
            cover={page.cover_url}
            fields={page.infobox as Record<string, unknown>}
            status={page.status}
            tags={tags}
            parentSlug={page.parent_slug}
          />
          <div className="flex-1 min-w-0">
            <Markdown>{page.content_md || "*Sem conteúdo ainda. Clique em Editar para começar.*"}</Markdown>

            {page.type === "series" && (children.data?.length ?? 0) > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-2xl font-bold mb-4 border-b border-border pb-2">Personagens</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {children.data!.map((c: any) => (
                    <Link
                      key={c.slug}
                      to="/wiki/$slug"
                      params={{ slug: c.slug }}
                      className="block p-3 rounded-lg border border-border bg-card hover:border-primary"
                    >
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">{c.type}</div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

function ReportButton({ pageId }: { pageId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const submit = async () => {
    if (!user || !reason.trim()) return;
    const { data: existingReport, error: existingError } = await supabase
      .from("reports")
      .select("id")
      .eq("page_id", pageId)
      .eq("reporter_id", user.id)
      .eq("status", "open")
      .maybeSingle();
    if (existingError) return toast.error("Erro ao verificar denúncia");
    if (existingReport) {
      toast.info("Você já enviou uma denúncia aberta para esta página.");
      setOpen(false);
      setReason("");
      return;
    }
    const { error } = await supabase.from("reports").insert({
      page_id: pageId,
      reporter_id: user.id,
      reason: reason.trim(),
    });
    if (error) return toast.error("Erro ao denunciar");
    toast.success("Denúncia enviada. A moderação vai analisar.");
    setOpen(false);
    setReason("");
  };
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border hover:border-destructive text-sm">
        <Flag className="w-4 h-4" /> Denunciar
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold mb-2">Denunciar página</h3>
            <p className="text-sm text-muted-foreground mb-3">Explique o problema (spam, vandalismo, conteúdo impróprio…).</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className="w-full p-2 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm mb-3" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="h-9 px-3 rounded-md border border-border text-sm">Cancelar</button>
              <button onClick={submit} className="h-9 px-3 rounded-md bg-destructive text-destructive-foreground text-sm">Enviar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

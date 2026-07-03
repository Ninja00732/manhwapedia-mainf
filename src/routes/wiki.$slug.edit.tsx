import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Markdown } from "@/components/Markdown";
import { PageTabs } from "@/components/PageTabs";
import { toast } from "sonner";

export const Route = createFileRoute("/wiki/$slug/edit")({
  head: ({ params }) => ({ meta: [{ title: `Editar ${params.slug} — ManhwaPedia` }] }),
  component: EditPage,
});

function EditPage() {
  const { slug } = Route.useParams();
  const { user, loading, isMod } = useAuth();
  const navigate = useNavigate();

  const { data: page } = useQuery({
    queryKey: ["wiki", slug],
    queryFn: async () => {
      const { data } = await supabase.from("wiki_pages").select("*").eq("slug", slug).maybeSingle();
      return data;
    },
  });

  const { data: allTags } = useQuery({
    queryKey: ["all-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("id,slug,name").order("name");
      return data ?? [];
    },
  });

  const { data: currentTags } = useQuery({
    queryKey: ["page-tags", slug],
    enabled: !!page,
    queryFn: async () => {
      const { data } = await supabase.from("page_tags").select("tag_id").eq("page_id", page!.id);
      return (data ?? []).map((r) => r.tag_id);
    },
  });

  const [title, setTitle] = useState("");
  const [cover, setCover] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string>("unknown");
  const [infoboxJson, setInfoboxJson] = useState("{}");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (page) {
      setTitle(page.title);
      setCover(page.cover_url ?? "");
      setContent(page.content_md);
      setStatus(page.status ?? "unknown");
      setInfoboxJson(JSON.stringify(page.infobox ?? {}, null, 2));
    }
  }, [page]);
  useEffect(() => {
    if (currentTags) setTagIds(currentTags);
  }, [currentTags]);

  const save = useMutation({
    mutationFn: async () => {
      if (!page || !user) throw new Error("Login necessário");
      let infobox: any = {};
      try {
        infobox = JSON.parse(infoboxJson);
      } catch {
        throw new Error("Infobox precisa ser JSON válido");
      }
      const { error } = await supabase.from("wiki_pages").update({
        title,
        cover_url: cover || null,
        content_md: content,
        status: page.type === "series" ? (status as any) : null,
        infobox,
        updated_by: user.id,
      }).eq("id", page.id);
      if (error) throw error;

      // Update tags: delete all, reinsert
      await supabase.from("page_tags").delete().eq("page_id", page.id);
      if (tagIds.length) {
        await supabase.from("page_tags").insert(tagIds.map((tag_id) => ({ page_id: page.id, tag_id })));
      }

      // If a comment was given, patch last revision (already created by trigger)
      if (comment.trim()) {
        const { data: last } = await supabase.from("revisions").select("id").eq("page_id", page.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (last) await supabase.from("revisions").update({ comment: comment.trim() }).eq("id", last.id);
      }
    },
    onSuccess: () => {
      toast.success("Alterações salvas");
      navigate({ to: "/wiki/$slug", params: { slug } });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  if (loading) return null;
  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="mb-4">Você precisa estar logado para editar.</p>
        <Link to="/auth" className="inline-flex items-center h-10 px-4 rounded-md bg-primary text-primary-foreground">Entrar</Link>
      </div>
    );
  }
  if (!page) return <div className="max-w-3xl mx-auto px-4 py-12">Página não encontrada.</div>;

  const canEdit = isMod || page.created_by === user.id;
  if (!canEdit) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold mb-2">Sem permissão para editar</h1>
        <p className="text-muted-foreground mb-6">Apenas o autor original da página ou a moderação podem editá-la. Você pode abrir uma discussão sugerindo mudanças.</p>
        <div className="flex justify-center gap-2">
          <Link to="/wiki/$slug" params={{ slug }} className="h-10 inline-flex items-center px-4 rounded-md border border-border">Voltar</Link>
          <Link to="/wiki/$slug/discuss" params={{ slug }} className="h-10 inline-flex items-center px-4 rounded-md bg-primary text-primary-foreground">Abrir discussão</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageTabs slug={slug} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-bold mb-6">Editar "{page.title}"</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Field label="Título">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </Field>
          <Field label="URL da capa (opcional)">
            <input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" className="input" />
          </Field>
          {page.type === "series" && (
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
                <option value="ongoing">Em andamento</option>
                <option value="completed">Concluído</option>
                <option value="hiatus">Em hiato</option>
                <option value="cancelled">Cancelado</option>
                <option value="unknown">Desconhecido</option>
              </select>
            </Field>
          )}
        </div>

        <Field label="Infobox (JSON — chaves como author, artist, release_date, chapters, role, abilities…)">
          <textarea value={infoboxJson} onChange={(e) => setInfoboxJson(e.target.value)} rows={8} className="input font-mono text-xs" />
        </Field>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted-foreground">Conteúdo (Markdown)</label>
            <button onClick={() => setPreview((v) => !v)} className="text-xs text-primary hover:underline">
              {preview ? "Editar" : "Pré-visualizar"}
            </button>
          </div>
          {preview ? (
            <div className="min-h-[300px] p-4 rounded-md border border-border bg-card">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={20} className="input font-mono text-sm" />
          )}
        </div>

        {allTags && (
          <div className="mt-4">
            <label className="text-sm text-muted-foreground">Tags</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {allTags.map((t) => {
                const active = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTagIds((s) => (active ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                    className={`text-xs px-3 py-1.5 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border hover:border-primary"}`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Field label="Resumo da edição (opcional)">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex: corrigi ortografia da sinopse" className="input" />
        </Field>

        <div className="flex justify-end gap-2 mt-6">
          <Link to="/wiki/$slug" params={{ slug }} className="h-10 inline-flex items-center px-4 rounded-md border border-border">Cancelar</Link>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="h-10 px-5 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
            {save.isPending ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </div>
      <style>{`
        .input { width: 100%; padding: 0.5rem 0.75rem; border-radius: 0.375rem; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-foreground); font-size: 0.875rem; }
        .input:focus { border-color: var(--color-primary); outline: none; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <label className="text-sm text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}

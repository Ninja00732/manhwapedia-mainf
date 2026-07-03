import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toSlug } from "@/lib/format";
import { toast } from "sonner";

const schema = z.object({ title: fallback(z.string(), "").default("") });

export const Route = createFileRoute("/create")({
  validateSearch: zodValidator(schema),
  head: () => ({ meta: [{ title: "Criar página — ManhwaPedia" }] }),
  component: CreatePage,
});

function CreatePage() {
  const { title: initialTitle } = Route.useSearch();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [type, setType] = useState<"series" | "character" | "lore">("series");
  const [title, setTitle] = useState(initialTitle);
  const [parent, setParent] = useState("");
  const [status, setStatus] = useState("ongoing");
  const [content, setContent] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Login necessário");
      if (!title.trim()) throw new Error("Título obrigatório");
      const slug = toSlug(title);
      const { error } = await supabase.from("wiki_pages").insert({
        slug,
        type,
        title: title.trim(),
        content_md: content,
        status: type === "series" ? (status as any) : null,
        parent_slug: type === "character" && parent ? parent : null,
        created_by: user.id,
        updated_by: user.id,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma página com esse título");
        throw error;
      }
      return slug;
    },
    onSuccess: (slug) => {
      toast.success("Página criada!");
      navigate({ to: "/wiki/$slug", params: { slug } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (loading) return null;
  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="mb-4">Você precisa estar logado para criar páginas.</p>
        <Link to="/auth" className="inline-flex items-center h-10 px-4 rounded-md bg-primary text-primary-foreground">Entrar</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-display text-3xl font-bold mb-6">Criar nova página</h1>

      <div className="space-y-4">
        <div>
          <label className="text-sm text-muted-foreground block mb-1">Tipo</label>
          <div className="flex gap-2">
            {(["series", "character", "lore"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 h-10 rounded-md border text-sm ${type === t ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border hover:border-primary"}`}
              >
                {t === "series" ? "Série" : t === "character" ? "Personagem" : "Lore"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Solo Leveling" className="w-full h-10 px-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm" />
          {title && <p className="text-xs text-muted-foreground mt-1">URL: /wiki/{toSlug(title)}</p>}
        </div>

        {type === "series" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full h-10 px-3 rounded-md bg-surface border border-border text-sm">
              <option value="ongoing">Em andamento</option>
              <option value="completed">Concluído</option>
              <option value="hiatus">Em hiato</option>
              <option value="cancelled">Cancelado</option>
              <option value="unknown">Desconhecido</option>
            </select>
          </div>
        )}

        {type === "character" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Slug da série (opcional)</label>
            <input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="jungle-juice" className="w-full h-10 px-3 rounded-md bg-surface border border-border text-sm" />
          </div>
        )}

        <div>
          <label className="text-sm text-muted-foreground block mb-1">Conteúdo inicial (Markdown)</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} placeholder="## Sinopse&#10;&#10;Escreva aqui…" className="w-full p-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm font-mono" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link to="/" className="h-10 inline-flex items-center px-4 rounded-md border border-border">Cancelar</Link>
          <button disabled={create.isPending} onClick={() => create.mutate()} className="h-10 px-5 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
            {create.isPending ? "Criando…" : "Criar página"}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Depois de criar, você poderá adicionar capa, tags e completar o infobox na aba <em>Editar</em>.
        </p>
      </div>
    </div>
  );
}

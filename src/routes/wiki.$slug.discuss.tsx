import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageTabs } from "@/components/PageTabs";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/wiki/$slug/discuss")({
  head: ({ params }) => ({ meta: [{ title: `Discussão de ${params.slug} — ManhwaPedia` }] }),
  component: DiscussPage,
});

function DiscussPage() {
  const { slug } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const { data: page } = useQuery({
    queryKey: ["wiki-mini", slug],
    queryFn: async () => (await supabase.from("wiki_pages").select("id,title").eq("slug", slug).maybeSingle()).data,
  });

  const { data: comments } = useQuery({
    queryKey: ["discussions", slug],
    enabled: !!page,
    queryFn: async () => {
      const { data } = await supabase
        .from("discussions")
        .select("id,content,created_at,deleted_at,author_id,profiles:author_id(username,display_name)")
        .eq("page_id", page!.id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      if (!user || !page || !text.trim()) return;
      const { error } = await supabase.from("discussions").insert({ page_id: page.id, author_id: user.id, content: text.trim() });
      if (error) throw error;
      setText("");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discussions", slug] }),
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("discussions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discussions", slug] }),
  });

  if (!page) return null;

  return (
    <div>
      <PageTabs slug={slug} />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-bold mb-1">Discussão sobre "{page.title}"</h1>
        <p className="text-sm text-muted-foreground mb-6">Debata mudanças antes de editar. Seja civilizado.</p>

        <ul className="space-y-3 mb-8">
          {(comments ?? []).map((c: any) => (
            <li key={c.id} className={`p-4 rounded-lg border border-border bg-card ${c.deleted_at ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">
                  {c.profiles?.display_name || c.profiles?.username || "Usuário"}
                  <span className="text-muted-foreground font-normal"> • {formatDate(c.created_at)}</span>
                </div>
                {(user?.id === c.author_id || isAdmin) && !c.deleted_at && (
                  <button onClick={() => del.mutate(c.id)} className="text-muted-foreground hover:text-destructive" title="Remover">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="text-sm whitespace-pre-wrap">{c.deleted_at ? "[removido]" : c.content}</div>
            </li>
          ))}
          {(comments ?? []).length === 0 && <li className="text-muted-foreground text-sm">Sem comentários ainda.</li>}
        </ul>

        {user ? (
          <div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Escreva um comentário…" className="w-full p-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm" />
            <div className="flex justify-end mt-2">
              <button disabled={!text.trim() || post.isPending} onClick={() => post.mutate()} className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
                Comentar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Link to="/auth" className="text-primary hover:underline">Entre</Link> para participar da discussão.
          </p>
        )}
      </div>
    </div>
  );
}

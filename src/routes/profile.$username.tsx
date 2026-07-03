import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/profile/$username")({
  head: ({ params }) => ({ meta: [{ title: `@${params.username} — ManhwaPedia` }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = Route.useParams();

  const { data: profile } = useQuery({
    queryKey: ["profile", username],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("username", username).maybeSingle();
      return data;
    },
  });

  const { data: edits } = useQuery({
    queryKey: ["profile-edits", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase
        .from("revisions")
        .select("id, created_at, title, comment, wiki_pages!inner(slug)")
        .eq("editor_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  if (!profile) return <div className="max-w-3xl mx-auto p-12 text-center text-muted-foreground">Usuário não encontrado.</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border grid place-items-center text-2xl font-bold">
          {profile.username[0]?.toUpperCase()}
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold">{profile.display_name || profile.username}</h1>
          <div className="text-muted-foreground text-sm">@{profile.username} • entrou em {formatDate(profile.created_at)}</div>
        </div>
      </div>

      {profile.bio && <p className="mb-6 text-foreground/90">{profile.bio}</p>}

      <h2 className="font-display text-xl font-bold mb-3">Contribuições recentes</h2>
      <ol className="divide-y divide-border rounded-lg border border-border bg-card">
        {(edits ?? []).map((e: any) => (
          <li key={e.id} className="p-3">
            <Link to="/wiki/$slug" params={{ slug: e.wiki_pages.slug }} className="font-medium hover:text-primary">
              {e.title}
            </Link>
            <div className="text-xs text-muted-foreground">
              {formatDate(e.created_at)} {e.comment ? `— ${e.comment}` : ""}
            </div>
          </li>
        ))}
        {(edits ?? []).length === 0 && <li className="p-4 text-sm text-muted-foreground">Sem contribuições ainda.</li>}
      </ol>
    </div>
  );
}

import { Link } from "@tanstack/react-router";

interface InfoboxProps {
  title: string;
  cover?: string | null;
  fields: Record<string, unknown>;
  status?: string | null;
  tags?: { slug: string; name: string }[];
  parentSlug?: string | null;
}

const LABELS: Record<string, string> = {
  author: "Autor",
  artist: "Ilustrador",
  release_date: "Estreia",
  chapters: "Capítulos",
  origin: "Origem",
  demographic: "Demografia",
  status: "Status",
  role: "Papel",
  species: "Espécie",
  abilities: "Habilidades",
  affiliation: "Afiliação",
  title: "Título",
  school: "Escola",
  appearance: "Aparência",
  personality: "Personalidade",
  series: "Série",
};

const STATUS_LABEL: Record<string, string> = {
  ongoing: "Em andamento",
  completed: "Concluído",
  hiatus: "Em hiato",
  cancelled: "Cancelado",
  unknown: "Desconhecido",
};

export function Infobox({ title, cover, fields, status, tags, parentSlug }: InfoboxProps) {
  const entries = Object.entries(fields ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  return (
    <aside className="w-full lg:w-[320px] shrink-0 rounded-lg border border-border bg-card overflow-hidden">
      {cover ? (
        <img src={cover} alt={title} className="w-full aspect-[3/4] object-cover" loading="lazy" />
      ) : (
        <div className="w-full aspect-[3/4] bg-surface-2 grid place-items-center text-muted-foreground text-sm">
          Sem imagem
        </div>
      )}
      <div className="p-4">
        <h2 className="font-display text-xl leading-tight mb-3">{title}</h2>
        <dl className="text-sm divide-y divide-border">
          {status && (
            <div className="grid grid-cols-[110px_1fr] gap-2 py-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="min-w-0">{STATUS_LABEL[status] ?? status}</dd>
            </div>
          )}
          {parentSlug && (
            <div className="grid grid-cols-[110px_1fr] gap-2 py-2">
              <dt className="text-muted-foreground">Série</dt>
              <dd className="min-w-0 truncate">
                <Link to="/wiki/$slug" params={{ slug: parentSlug }} className="text-primary hover:underline">
                  {parentSlug}
                </Link>
              </dd>
            </div>
          )}
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px_1fr] gap-2 py-2">
              <dt className="text-muted-foreground">{LABELS[k] ?? k}</dt>
              <dd className="min-w-0 break-words">{String(v)}</dd>
            </div>
          ))}
        </dl>
        {tags && tags.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Link
                  key={t.slug}
                  to="/browse"
                  search={{ tag: t.slug }}
                  className="text-xs bg-surface-2 hover:bg-muted px-2 py-1 rounded-md border border-border transition-colors"
                >
                  {t.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

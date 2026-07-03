import { Link, useLocation } from "@tanstack/react-router";
import { BookText, MessageSquare, History as HistoryIcon, Pencil } from "lucide-react";

export function PageTabs({ slug }: { slug: string }) {
  const path = useLocation({ select: (l) => l.pathname });
  const base = `/wiki/${slug}`;
  const tabs = [
    { to: base, label: "Artigo", icon: BookText, exact: true },
    { to: `${base}/discuss`, label: "Discussão", icon: MessageSquare },
    { to: `${base}/history`, label: "Histórico", icon: HistoryIcon },
    { to: `${base}/edit`, label: "Editar", icon: Pencil },
  ];
  return (
    <div className="border-b border-border">
      <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = t.exact ? path === t.to : path.startsWith(t.to);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`inline-flex items-center gap-1.5 px-4 h-11 text-sm border-b-2 whitespace-nowrap ${
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

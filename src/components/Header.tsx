import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, Search, Plus, User as UserIcon, LogOut, ListChecks, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function Header() {
  const { user, profile, isMod, signOut } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate({ to: "/search", search: { q: q.trim() } });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <BookOpen className="w-5 h-5 text-primary" />
          <span className="font-display text-lg font-bold tracking-tight">ManhwaPedia</span>
        </Link>

        <nav className="hidden md:flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/browse" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>Catálogo</Link>
          <Link to="/create" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>Criar página</Link>
          {isMod && (
            <Link to="/moderation" className="hover:text-foreground flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" /> Moderação
            </Link>
          )}
        </nav>

        <form onSubmit={submit} className="flex-1 flex justify-end md:justify-center max-w-md ml-auto">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar séries, personagens…"
              className="w-full h-9 pl-8 pr-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm"
            />
          </div>
        </form>

        <div className="flex items-center gap-2">
          <Link
            to="/create"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> Nova página
          </Link>
          {user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full bg-surface-2 border border-border grid place-items-center text-sm font-medium hover:border-primary"
                aria-label="Menu do usuário"
              >
                {profile?.username?.[0]?.toUpperCase() ?? "U"}
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-2 w-52 rounded-md border border-border bg-popover shadow-lg py-1 text-sm"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <div className="px-3 py-2 border-b border-border">
                    <div className="font-medium truncate">{profile?.display_name ?? profile?.username}</div>
                    <div className="text-xs text-muted-foreground truncate">@{profile?.username}</div>
                  </div>
                  {profile && (
                    <Link
                      to="/profile/$username"
                      params={{ username: profile.username }}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted"
                      onClick={() => setMenuOpen(false)}
                    >
                      <UserIcon className="w-4 h-4" /> Meu perfil
                    </Link>
                  )}
                  <Link to="/watchlist" className="flex items-center gap-2 px-3 py-2 hover:bg-muted" onClick={() => setMenuOpen(false)}>
                    <ListChecks className="w-4 h-4" /> Watchlist
                  </Link>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-muted text-destructive"
                  >
                    <LogOut className="w-4 h-4" /> Sair
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/auth"
              className="inline-flex items-center h-9 px-3 rounded-md border border-border hover:border-primary text-sm"
            >
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

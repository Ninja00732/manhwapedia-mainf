import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import "../lib/fonts";
import { AuthProvider } from "@/lib/auth";
import { Header } from "@/components/Header";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const pathname = window.location.pathname;
    const isOAuthCallbackPath = ["/~oauth", "/iframe-oauth", "/oauth"].some((prefix) => pathname.startsWith(prefix));

    if (isOAuthCallbackPath) {
      window.location.replace("/auth");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Essa página não existe ainda. Que tal criá-la?
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <a href="/" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Voltar
          </a>
          <a href="/create" className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm">
            Criar página
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tente recarregar a página.</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ManhwaPedia — a wiki colaborativa de manhwa e mangá" },
      { name: "description", content: "Enciclopédia colaborativa dedicada a manhwas, mangás e webtoons. Séries, personagens, lore e curiosidades escritos pela comunidade." },
      { name: "author", content: "ManhwaPedia" },
      { property: "og:title", content: "ManhwaPedia — a wiki colaborativa de manhwa e mangá" },
      { property: "og:description", content: "Enciclopédia colaborativa dedicada a manhwas, mangás e webtoons. Séries, personagens, lore e curiosidades escritos pela comunidade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "ManhwaPedia — a wiki colaborativa de manhwa e mangá" },
      { name: "twitter:description", content: "Enciclopédia colaborativa dedicada a manhwas, mangás e webtoons. Séries, personagens, lore e curiosidades escritos pela comunidade." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">
            <Outlet />
          </main>
          <footer className="border-t border-border mt-16 py-6 text-center text-xs text-muted-foreground">
            ManhwaPedia — conteúdo colaborativo escrito pela comunidade. Todas as sinopses são originais.
          </footer>
        </div>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

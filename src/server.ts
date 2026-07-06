import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// Esta função "fetch" corre em Bun (ver Start Command no Render:
// "bun dist/server/server.js"). Este handler trata apenas do SSR das
// páginas — não sabe nada sobre os ficheiros gerados em dist/client
// (JS, CSS, fontes). Por isso, antes de tentar renderizar uma página,
// verificamos se o pedido é para um ficheiro estático e, se for,
// servimo-lo diretamente do disco com Bun.file().
const CLIENT_DIR = new URL("../client/", import.meta.url);

function guessContentType(pathname: string): string | undefined {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".woff2")) return "font/woff2";
  if (pathname.endsWith(".woff")) return "font/woff";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  return undefined;
}

async function tryServeStaticAsset(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  // Só ficheiros com extensão (ex: /assets/index-abc.js) — deixa tudo o
  // resto (rotas normais da app, como "/" ou "/wiki/xyz") passar para o SSR.
  if (!/\.[a-zA-Z0-9]+$/.test(url.pathname)) return null;

  const filePath = new URL("." + url.pathname, CLIENT_DIR);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const contentType = guessContentType(url.pathname) ?? file.type;
  return new Response(file, {
    headers: {
      "content-type": contentType,
      // ficheiros com hash no nome (ex: index-BqU2Dc_i.js) podem ser
      // cacheados de forma agressiva e segura
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const staticResponse = await tryServeStaticAsset(request);
      if (staticResponse) return staticResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

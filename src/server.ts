import { loadEnv } from "./env";
loadEnv();

import { authenticate } from "./auth";
import { sync, type SyncRequest } from "./db";

const PORT = parseInt(process.env.PORT || "8080");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === "/api/ping" && request.method === "GET") {
      return json({ ok: true, version: "1.0.0" });
    }

    // All routes require auth
    if (!authenticate(request)) return error("Unauthorized", 401);

    // Sync endpoint
    if (path === "/api/sync" && request.method === "POST") {
      let body: SyncRequest;
      try {
        body = await request.json();
      } catch {
        return error("Invalid JSON", 400);
      }
      const result = sync(body);
      return json(result);
    }

    // Pull-only convenience (GET with since param)
    if (path === "/api/sync" && request.method === "GET") {
      const since = url.searchParams.get("since") ?? undefined;
      const result = sync({ since });
      return json(result);
    }

    return error("Not found", 404);
  },
});

console.log(`itsysync listening on http://localhost:${server.port}`);

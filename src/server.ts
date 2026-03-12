import { loadEnv } from "./env";
loadEnv();

import { authenticate } from "./auth";
import { createUser, sync, type SyncRequest } from "./db";

const PORT = parseInt(process.env.PORT || "8080");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

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

    // Create user (admin-only)
    if (path === "/api/users" && request.method === "POST") {
      if (!ADMIN_TOKEN) return error("Admin token not configured", 503);
      const adminAuth = request.headers.get("Authorization");
      if (adminAuth !== `Bearer ${ADMIN_TOKEN}`) return error("Unauthorized", 401);

      const body = (await request.json()) as { name?: string };
      const { id, token } = createUser(body.name ?? "");
      return json({ id, token }, 201);
    }

    // All other routes require user auth
    const user = authenticate(request);
    if (!user) return error("Unauthorized", 401);

    // Sync endpoint
    if (path === "/api/sync" && request.method === "POST") {
      const body = (await request.json()) as SyncRequest;
      const result = sync(user.id, body);
      return json(result);
    }

    // Pull-only convenience (GET with since param)
    if (path === "/api/sync" && request.method === "GET") {
      const since = url.searchParams.get("since") ?? undefined;
      const result = sync(user.id, { since });
      return json(result);
    }

    return error("Not found", 404);
  },
});

console.log(`itsysync listening on http://localhost:${server.port}`);

import { timingSafeEqual } from "crypto";

const TOKEN = process.env.ADMIN_TOKEN || "";
const TOKEN_BUF = Buffer.from(TOKEN);

export function authenticate(request: Request): boolean {
  if (!TOKEN) return false;
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  if (provided.length !== TOKEN_BUF.length) return false;
  return timingSafeEqual(provided, TOKEN_BUF);
}

import { getUserByToken } from "./db";

export interface AuthUser {
  id: number;
  name: string;
}

export function authenticate(request: Request): AuthUser | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!token) return null;
  return getUserByToken(token);
}

import { Database } from "bun:sqlite";
import { randomBytes, createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "itsysync.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scratch_tabs (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'plain',
    language_locked INTEGER NOT NULL DEFAULT 0,
    last_modified TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    PRIMARY KEY (id, user_id)
  );

  CREATE TABLE IF NOT EXISTS clipboard_entries (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    PRIMARY KEY (id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tabs_user_updated ON scratch_tabs(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_clipboard_user_updated ON clipboard_entries(user_id, updated_at);
`);

// --- Token helpers ---

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// --- User operations ---

export function createUser(name: string): { id: number; token: string } {
  const token = generateToken();
  const hash = hashToken(token);
  const result = db.prepare("INSERT INTO users (name, token_hash) VALUES (?, ?)").run(name, hash);
  return { id: Number(result.lastInsertRowid), token };
}

export function getUserByToken(token: string): { id: number; name: string } | null {
  const hash = hashToken(token);
  const row = db.prepare("SELECT id, name FROM users WHERE token_hash = ?").get(hash) as
    | { id: number; name: string }
    | undefined;
  return row ?? null;
}

// --- Types ---

export interface TabRow {
  id: string;
  name: string;
  content: string;
  language: string;
  language_locked: number;
  last_modified: string;
}

export interface TabUpsert {
  id: string;
  name: string;
  content: string;
  language: string;
  languageLocked: boolean;
  lastModified: string;
}

export interface ClipboardRow {
  id: string;
  text: string;
  timestamp: string;
}

export interface ClipboardUpsert {
  id: string;
  text: string;
  timestamp: string;
}

// --- Sync operations ---

const upsertTab = db.prepare(`
  INSERT INTO scratch_tabs (id, user_id, name, content, language, language_locked, last_modified, updated_at, deleted_at)
  VALUES ($id, $user_id, $name, $content, $language, $language_locked, $last_modified, datetime('now'), NULL)
  ON CONFLICT(id, user_id) DO UPDATE SET
    name = CASE WHEN excluded.last_modified > scratch_tabs.last_modified THEN excluded.name ELSE scratch_tabs.name END,
    content = CASE WHEN excluded.last_modified > scratch_tabs.last_modified THEN excluded.content ELSE scratch_tabs.content END,
    language = CASE WHEN excluded.last_modified > scratch_tabs.last_modified THEN excluded.language ELSE scratch_tabs.language END,
    language_locked = CASE WHEN excluded.last_modified > scratch_tabs.last_modified THEN excluded.language_locked ELSE scratch_tabs.language_locked END,
    last_modified = CASE WHEN excluded.last_modified > scratch_tabs.last_modified THEN excluded.last_modified ELSE scratch_tabs.last_modified END,
    updated_at = datetime('now'),
    deleted_at = NULL
`);

const deleteTab = db.prepare(`
  UPDATE scratch_tabs SET deleted_at = datetime('now'), updated_at = datetime('now')
  WHERE id = $id AND user_id = $user_id AND deleted_at IS NULL
`);

const upsertClipboard = db.prepare(`
  INSERT INTO clipboard_entries (id, user_id, text, timestamp, updated_at, deleted_at)
  VALUES ($id, $user_id, $text, $timestamp, datetime('now'), NULL)
  ON CONFLICT(id, user_id) DO UPDATE SET
    text = excluded.text,
    timestamp = excluded.timestamp,
    updated_at = datetime('now'),
    deleted_at = NULL
`);

const deleteClipboard = db.prepare(`
  UPDATE clipboard_entries SET deleted_at = datetime('now'), updated_at = datetime('now')
  WHERE id = $id AND user_id = $user_id AND deleted_at IS NULL
`);

export interface SyncRequest {
  since?: string;
  changes?: {
    tabs?: {
      upsert?: TabUpsert[];
      delete?: string[];
    };
    clipboard?: {
      upsert?: ClipboardUpsert[];
      delete?: string[];
    };
  };
}

export interface SyncResponse {
  serverTime: string;
  changes: {
    tabs: { upsert: TabRow[]; delete: string[] };
    clipboard: { upsert: ClipboardRow[]; delete: string[] };
  };
}

export function sync(userId: number, request: SyncRequest): SyncResponse {
  const now = new Date().toISOString();

  // Apply incoming changes inside a transaction
  const applyChanges = db.transaction(() => {
    const tabChanges = request.changes?.tabs;
    if (tabChanges) {
      for (const tab of tabChanges.upsert ?? []) {
        upsertTab.run({
          $id: tab.id,
          $user_id: userId,
          $name: tab.name,
          $content: tab.content,
          $language: tab.language,
          $language_locked: tab.languageLocked ? 1 : 0,
          $last_modified: tab.lastModified,
        });
      }
      for (const id of tabChanges.delete ?? []) {
        deleteTab.run({ $id: id, $user_id: userId });
      }
    }

    const clipChanges = request.changes?.clipboard;
    if (clipChanges) {
      for (const entry of clipChanges.upsert ?? []) {
        upsertClipboard.run({
          $id: entry.id,
          $user_id: userId,
          $text: entry.text,
          $timestamp: entry.timestamp,
        });
      }
      for (const id of clipChanges.delete ?? []) {
        deleteClipboard.run({ $id: id, $user_id: userId });
      }
    }
  });

  applyChanges();

  // Fetch changes for the client (everything modified since `since`)
  const since = request.since ?? "1970-01-01T00:00:00Z";

  const tabUpserts = db
    .prepare(
      `SELECT id, name, content, language, language_locked, last_modified
       FROM scratch_tabs
       WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    )
    .all(userId, since) as TabRow[];

  const tabDeletes = db
    .prepare(
      `SELECT id FROM scratch_tabs
       WHERE user_id = ? AND updated_at > ? AND deleted_at IS NOT NULL`
    )
    .all(userId, since) as { id: string }[];

  const clipUpserts = db
    .prepare(
      `SELECT id, text, timestamp
       FROM clipboard_entries
       WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    )
    .all(userId, since) as ClipboardRow[];

  const clipDeletes = db
    .prepare(
      `SELECT id FROM clipboard_entries
       WHERE user_id = ? AND updated_at > ? AND deleted_at IS NOT NULL`
    )
    .all(userId, since) as { id: string }[];

  return {
    serverTime: now,
    changes: {
      tabs: {
        upsert: tabUpserts,
        delete: tabDeletes.map((r) => r.id),
      },
      clipboard: {
        upsert: clipUpserts,
        delete: clipDeletes.map((r) => r.id),
      },
    },
  };
}

export default db;

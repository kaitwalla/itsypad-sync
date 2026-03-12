# itsysync

A lightweight sync server for [Itsy](https://github.com/anthropics/itsy) — syncs scratch tabs and clipboard entries across devices.

Built with [Bun](https://bun.sh) and SQLite.

## API

All endpoints return JSON. Protected routes require `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/ping` | None | Health check |
| `POST` | `/api/users` | Admin | Create a new user |
| `POST` | `/api/sync` | User | Bidirectional sync (push changes, pull updates) |
| `GET` | `/api/sync?since=<ISO timestamp>` | User | Pull changes since timestamp |

## Setup

```bash
cp .env.example .env   # edit ADMIN_TOKEN
bun install
```

## Run

```bash
bun run dev     # watch mode
bun run start   # production
```

## Docker

```bash
docker compose up -d
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `ADMIN_TOKEN` | — | Required. Token for creating users via `POST /api/users` |
| `DATA_DIR` | `./data` | SQLite database directory |

## Sync Protocol

Clients send a `POST /api/sync` with changes and a `since` timestamp. The server applies incoming changes (last-write-wins by `lastModified`), then returns all server-side changes since `since`. Deletes are soft (tracked via `deleted_at`), so clients can reconcile removals.

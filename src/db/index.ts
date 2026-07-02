import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "schema.sql");

export type Db = Database.Database;

let singleton: Db | undefined;

/**
 * Open (and migrate) the LSP SQLite database. Idempotent: schema.sql uses
 * CREATE TABLE IF NOT EXISTS, so calling this on an existing db is safe.
 */
export function openDb(path = process.env.DATABASE_PATH ?? "./data/lsp.sqlite"): Db {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

/** Process-wide shared handle for the service. Tests may call openDb(":memory:") directly. */
export function getDb(): Db {
  if (!singleton) singleton = openDb();
  return singleton;
}

export function closeDb(): void {
  singleton?.close();
  singleton = undefined;
}

/** Milliseconds-since-epoch helper so all rows stamp time consistently. */
export function now(): number {
  return Date.now();
}

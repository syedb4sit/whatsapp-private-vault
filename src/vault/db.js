// Uses the built-in node:sqlite module (Node.js >= 22.5, stable in Node 24).
// No native build required — zero npm dependencies for SQLite.
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../vault.db');

let db;

/**
 * Returns the active DatabaseSync instance.
 * Must be called after initDB().
 */
export function getDB() {
  return db;
}

/**
 * Initialize the SQLite database and create the schema if it doesn't exist.
 */
export function initDB() {
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      tags        TEXT DEFAULT '[]',
      embedding   TEXT,
      media_id    TEXT,
      mime_type   TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_secret   INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_created ON items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_type ON items(type);
  `);
  console.log(`📦 Vault DB initialized at ${DB_PATH}`);
}

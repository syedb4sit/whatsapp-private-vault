import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../vault.db');
const JSON_PATH = path.join(__dirname, '../../vault.json');

let db;
let DatabaseSyncClass = null;

try {
  const sqlite = await import('node:sqlite');
  DatabaseSyncClass = sqlite.DatabaseSync;
} catch (err) {
  // Built-in SQLite not available or experimental flag not passed
}

/**
 * Lightweight JSON file fallback engine
 * matching the exact SQLite DatabaseSync interface used by store.js and search.js.
 */
class JsonDatabaseFallback {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = [];
    this.nextId = 1;
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.items = JSON.parse(raw);
        const maxId = this.items.reduce((max, i) => Math.max(max, i.id || 0), 0);
        this.nextId = maxId + 1;
      } catch (e) {
        this.items = [];
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save vault.json:', e);
    }
  }

  exec(sql) {
    // schema create statements - no-op for JSON store
  }

  prepare(sql) {
    const s = sql.trim().toLowerCase();
    const self = this;

    // 1. INSERT INTO items ...
    if (s.startsWith('insert into items')) {
      return {
        run: (type, content, tags, embedding, media_id, mime_type, is_secret) => {
          const item = {
            id: self.nextId++,
            type,
            content,
            tags: typeof tags === 'string' ? tags : JSON.stringify(tags || []),
            embedding: embedding ? (typeof embedding === 'string' ? embedding : JSON.stringify(embedding)) : null,
            media_id,
            mime_type,
            is_secret: is_secret ? 1 : 0,
            created_at: new Date().toISOString(),
          };
          self.items.push(item);
          self.save();
          return { lastInsertRowid: item.id };
        },
      };
    }

    // 2. SELECT id, type, content, tags, is_secret, created_at FROM items ORDER BY created_at DESC LIMIT ?
    if (s.includes('order by created_at desc limit ?')) {
      return {
        all: (limit = 10) => {
          return self.items
            .slice()
            .reverse()
            .slice(0, Number(limit))
            .map(i => ({
              id: i.id,
              type: i.type,
              content: i.content,
              tags: i.tags,
              is_secret: i.is_secret,
              created_at: i.created_at,
            }));
        },
      };
    }

    // 3. SELECT * FROM items WHERE id = ? / DELETE FROM items WHERE id = ?
    if (s.includes('where id = ?')) {
      return {
        get: (id) => self.items.find(i => Number(i.id) === Number(id)) || null,
        run: (id) => {
          const idx = self.items.findIndex(i => Number(i.id) === Number(id));
          if (idx !== -1) {
            self.items.splice(idx, 1);
            self.save();
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    }

    // 4. SELECT id, type, content, tags, embedding, is_secret FROM items WHERE embedding IS NOT NULL
    if (s.includes('embedding is not null')) {
      return {
        all: () => self.items.filter(i => i.embedding !== null && i.embedding !== undefined),
      };
    }

    // 5. SELECT COUNT(*) as count FROM items
    if (s.includes('count(*) as count')) {
      return {
        get: () => ({ count: self.items.length }),
      };
    }

    // 6. Keyword search: content LIKE ? OR tags LIKE ?
    if (s.includes('content like ? or tags like ?')) {
      return {
        all: (contentLike, tagsLike) => {
          const term = (contentLike || '').replace(/%/g, '').toLowerCase();
          return self.items
            .slice()
            .reverse()
            .filter(i => {
              const c = (i.content || '').toLowerCase();
              const t = (i.tags || '').toLowerCase();
              return c.includes(term) || t.includes(term);
            })
            .slice(0, 10);
        },
      };
    }

    // 7. Multi-token LIKE search
    if (s.includes('content like ?')) {
      return {
        all: (...params) => {
          const terms = params.map(p => p.replace(/%/g, '').toLowerCase());
          return self.items
            .slice()
            .reverse()
            .filter(i => {
              const c = (i.content || '').toLowerCase();
              return terms.some(t => c.includes(t));
            })
            .slice(0, 10);
        },
      };
    }

    // Generic fallback
    return {
      run: () => ({ changes: 0 }),
      get: () => null,
      all: () => [],
    };
  }
}

/**
 * Returns the active Database instance.
 */
export function getDB() {
  return db;
}

/**
 * Initialize SQLite database with automatic fallback to persistent JSON store.
 */
export function initDB() {
  if (DatabaseSyncClass) {
    try {
      db = new DatabaseSyncClass(DB_PATH);
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
      console.log(`📦 Vault DB initialized with SQLite at ${DB_PATH}`);
      return;
    } catch (err) {
      console.warn('SQLite init error, switching to JSON storage fallback:', err.message);
    }
  }

  // Graceful fallback if SQLite is not available or experimental flag is omitted
  db = new JsonDatabaseFallback(JSON_PATH);
  console.log(`📦 Vault DB initialized with JSON storage at ${JSON_PATH}`);
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreFromCloud, scheduleCloudBackup } from './cloudSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}
const DB_PATH = path.join(DATA_DIR, 'vault.db');
const JSON_PATH = path.join(DATA_DIR, 'vault.json');

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
    this.reminders = [];
    this.nextId = 1;
    this.nextReminderId = 1;
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
          this.reminders = [];
        } else {
          this.items = parsed.items || [];
          this.reminders = parsed.reminders || [];
        }
        const maxId = this.items.reduce((max, i) => Math.max(max, i.id || 0), 0);
        this.nextId = maxId + 1;
        const maxRemId = this.reminders.reduce((max, r) => Math.max(max, r.id || 0), 0);
        this.nextReminderId = maxRemId + 1;
      } catch (e) {
        this.items = [];
        this.reminders = [];
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ items: this.items, reminders: this.reminders }, null, 2),
        'utf8'
      );
      scheduleCloudBackup(this.filePath);
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

    // ── REMINDERS TABLE QUERIES ─────────────────────────────────────────────
    if (s.startsWith('insert into reminders')) {
      return {
        run: (user_id, content, due_at) => {
          const reminder = {
            id: self.nextReminderId++,
            user_id: user_id || 'default_user',
            content,
            due_at,
            created_at: new Date().toISOString(),
            sent_at: null,
          };
          self.reminders.push(reminder);
          self.save();
          return { lastInsertRowid: reminder.id };
        },
      };
    }

    if (s.includes('from reminders') && s.includes('due_at <= ?') && s.includes('sent_at is null')) {
      return {
        all: (nowIso) => {
          const cutoff = nowIso || new Date().toISOString();
          return self.reminders
            .filter(r => r.due_at <= cutoff && !r.sent_at)
            .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
        },
      };
    }

    if (s.startsWith('update reminders set sent_at = ? where id = ?')) {
      return {
        run: (sentAt, id) => {
          const rem = self.reminders.find(r => Number(r.id) === Number(id));
          if (rem) {
            rem.sent_at = sentAt;
            self.save();
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    }

    if (s.includes('from reminders') && s.includes('sent_at is null')) {
      return {
        all: (userId) => {
          let list = self.reminders.filter(r => !r.sent_at);
          if (userId && userId !== '*') {
            list = list.filter(r => r.user_id === userId);
          }
          return list.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
        },
      };
    }

    if (s.startsWith('delete from reminders where sent_at is null')) {
      return {
        run: (userId) => {
          const before = self.reminders.filter(r => !r.sent_at).length;
          self.reminders = self.reminders.filter(
            r => r.sent_at || (userId && userId !== '*' && r.user_id !== userId)
          );
          self.save();
          return { changes: before - self.reminders.filter(r => !r.sent_at).length };
        },
      };
    }

    if (s.startsWith('delete from reminders where id = ?')) {
      return {
        run: (id) => {
          const idx = self.reminders.findIndex(r => Number(r.id) === Number(id));
          if (idx !== -1) {
            self.reminders.splice(idx, 1);
            self.save();
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    }

    if (s.includes('from reminders where id = ?')) {
      return {
        get: (id) => self.reminders.find(r => Number(r.id) === Number(id)) || null,
      };
    }

    if (s.includes('count(*) as count from reminders')) {
      return {
        get: () => ({ count: self.reminders.filter(r => !r.sent_at).length }),
      };
    }

    // ── ITEMS TABLE QUERIES ─────────────────────────────────────────────────
    // 1. INSERT INTO items ...
    if (s.startsWith('insert into items')) {
      return {
        run: (type, content, tags, embedding, media_id, mime_type, file_path, is_secret) => {
          const item = {
            id: self.nextId++,
            type,
            content,
            tags: typeof tags === 'string' ? tags : JSON.stringify(tags || []),
            embedding: embedding ? (typeof embedding === 'string' ? embedding : JSON.stringify(embedding)) : null,
            media_id,
            mime_type,
            file_path: file_path || null,
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
              media_id: i.media_id,
              mime_type: i.mime_type,
              file_path: i.file_path,
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
    if (s.includes('count(*) as count from items') || s.includes('count(*) as count')) {
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

/**
 * Export SQLite tables to JSON snapshot and trigger cloud backup.
 */
/**
 * Export SQLite tables to JSON snapshot and trigger cloud backup.
 */
export function syncSqliteToJson() {
  if (!db || !DatabaseSyncClass || !(db instanceof DatabaseSyncClass)) return;
  try {
    const items = db.prepare('SELECT * FROM items').all();
    const reminders = db.prepare('SELECT * FROM reminders').all();
    fs.writeFileSync(
      JSON_PATH,
      JSON.stringify({ items, reminders }, null, 2),
      'utf8'
    );
    scheduleCloudBackup(JSON_PATH);
  } catch (err) {
    // Non-critical, ignore
  }
}

/**
 * Seed SQLite database from restored JSON snapshot if tables are empty.
 */
export function seedSqliteFromJson() {
  if (!db || !DatabaseSyncClass || !(db instanceof DatabaseSyncClass)) return;
  if (!fs.existsSync(JSON_PATH)) return;

  try {
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const items = parsed.items || (Array.isArray(parsed) ? parsed : []);
    const reminders = parsed.reminders || [];

    const currentCount = db.prepare('SELECT COUNT(*) as count FROM items').get()?.count || 0;
    if (currentCount === 0 && items.length > 0) {
      console.log(`📥 Restoring ${items.length} items from JSON/cloud into SQLite...`);
      const insertItem = db.prepare(`
        INSERT INTO items (id, type, content, tags, embedding, media_id, mime_type, file_path, created_at, is_secret)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const i of items) {
        insertItem.run(
          i.id,
          i.type || 'note',
          i.content || '',
          typeof i.tags === 'string' ? i.tags : JSON.stringify(i.tags || []),
          i.embedding ? (typeof i.embedding === 'string' ? i.embedding : JSON.stringify(i.embedding)) : null,
          i.media_id || null,
          i.mime_type || null,
          i.file_path || null,
          i.created_at || new Date().toISOString(),
          i.is_secret ? 1 : 0
        );
      }
    }

    const currentRemCount = db.prepare('SELECT COUNT(*) as count FROM reminders').get()?.count || 0;
    if (currentRemCount === 0 && reminders.length > 0) {
      console.log(`📥 Restoring ${reminders.length} reminders from JSON/cloud into SQLite...`);
      const insertRem = db.prepare(`
        INSERT INTO reminders (id, user_id, content, due_at, created_at, sent_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of reminders) {
        insertRem.run(
          r.id,
          r.user_id || 'default_user',
          r.content || '',
          r.due_at,
          r.created_at || new Date().toISOString(),
          r.sent_at || null
        );
      }
    }
  } catch (migErr) {
    console.warn('⚠️ SQLite JSON restore seeding note:', migErr.message);
  }
}

/**
 * Restore cloud backup if credentials are configured.
 */
export async function initCloudSync() {
  const restored = await restoreFromCloud(JSON_PATH);
  if (restored) {
    seedSqliteFromJson();
  }
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
          file_path   TEXT,
          created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_secret   INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_created ON items(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_type ON items(type);

        CREATE TABLE IF NOT EXISTS reminders (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     TEXT NOT NULL,
          content     TEXT NOT NULL,
          due_at      TEXT NOT NULL,
          created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
          sent_at     TEXT DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, sent_at);
      `);

      try {
        db.exec(`ALTER TABLE items ADD COLUMN file_path TEXT;`);
      } catch (alterErr) {
        // column already exists
      }

      // Check if local JSON exists and seed if empty
      seedSqliteFromJson();

      console.log(`📦 Vault DB initialized with SQLite at ${DB_PATH} (Items & Reminders active)`);
      return db;
    } catch (err) {
      console.warn('SQLite init error, switching to JSON storage fallback:', err.message);
    }
  }

  // Graceful fallback if SQLite is not available or experimental flag is omitted
  db = new JsonDatabaseFallback(JSON_PATH);
  console.log(`📦 Vault DB initialized with JSON storage at ${JSON_PATH} (Items & Reminders active)`);
  return db;
}

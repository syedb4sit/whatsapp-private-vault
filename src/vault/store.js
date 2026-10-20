import { getDB } from './db.js';

export function save({ type, content, tags = [], embedding = null, mediaId = null, mimeType = null, isSecret = false }) {
  const db = getDB();
  const stmt = db.prepare(
    `INSERT INTO items (type, content, tags, embedding, media_id, mime_type, is_secret)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    type,
    content,
    JSON.stringify(tags),
    embedding ? JSON.stringify(embedding) : null,
    mediaId,
    mimeType,
    isSecret ? 1 : 0
  );
  return result.lastInsertRowid;
}

export function listRecent(limit = 10) {
  const db = getDB();
  return db
    .prepare(
      `SELECT id, type, content, tags, is_secret, created_at
       FROM items ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit);
}

export function getById(id) {
  const db = getDB();
  return db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
}

export function deleteItem(id) {
  const db = getDB();
  return db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
}

export function getAllWithEmbeddings() {
  const db = getDB();
  return db
    .prepare(
      `SELECT id, type, content, tags, embedding, is_secret
       FROM items WHERE embedding IS NOT NULL`
    )
    .all();
}

export function getCount() {
  const db = getDB();
  return db.prepare(`SELECT COUNT(*) as count FROM items`).get().count;
}

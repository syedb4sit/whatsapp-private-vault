import { getDB } from './db.js';

// ── VAULT ITEMS ─────────────────────────────────────────────────────────────

export function save({
  type,
  content,
  tags = [],
  embedding = null,
  mediaId = null,
  mimeType = null,
  filePath = null,
  isSecret = false,
}) {
  const db = getDB();
  const stmt = db.prepare(
    `INSERT INTO items (type, content, tags, embedding, media_id, mime_type, file_path, is_secret)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    type,
    content,
    JSON.stringify(tags),
    embedding ? JSON.stringify(embedding) : null,
    mediaId,
    mimeType,
    filePath,
    isSecret ? 1 : 0
  );
  return result.lastInsertRowid;
}

export function listRecent(limit = 10) {
  const db = getDB();
  return db
    .prepare(
      `SELECT id, type, content, tags, is_secret, media_id, mime_type, file_path, created_at
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

// ── REMINDERS ───────────────────────────────────────────────────────────────

export function saveReminder({ userId, content, dueAt }) {
  const db = getDB();
  const stmt = db.prepare(
    `INSERT INTO reminders (user_id, content, due_at) VALUES (?, ?, ?)`
  );
  const result = stmt.run(userId, content, dueAt);
  return result.lastInsertRowid;
}

export function getDueReminders(nowIso = new Date().toISOString()) {
  const db = getDB();
  return db
    .prepare(
      `SELECT id, user_id, content, due_at, created_at
       FROM reminders WHERE due_at <= ? AND sent_at IS NULL ORDER BY due_at ASC`
    )
    .all(nowIso);
}

export function markReminderSent(id, sentAt = new Date().toISOString()) {
  const db = getDB();
  return db
    .prepare(`UPDATE reminders SET sent_at = ? WHERE id = ?`)
    .run(sentAt, id);
}

export function listUpcomingReminders(userId) {
  const db = getDB();
  if (userId && userId !== '*') {
    return db
      .prepare(
        `SELECT id, user_id, content, due_at, created_at
         FROM reminders WHERE sent_at IS NULL AND user_id = ? ORDER BY due_at ASC`
      )
      .all(userId);
  }
  return db
    .prepare(
      `SELECT id, user_id, content, due_at, created_at
       FROM reminders WHERE sent_at IS NULL ORDER BY due_at ASC`
    )
    .all();
}

export function deleteReminder(id) {
  const db = getDB();
  return db.prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
}

export function deleteAllReminders(userId) {
  const db = getDB();
  if (userId && userId !== '*') {
    const res = db.prepare(`DELETE FROM reminders WHERE sent_at IS NULL AND user_id = ?`).run(userId);
    return res?.changes || 0;
  }
  const res = db.prepare(`DELETE FROM reminders WHERE sent_at IS NULL`).run();
  return res?.changes || 0;
}

export function getReminderById(id) {
  const db = getDB();
  return db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id);
}

export function getReminderCount() {
  const db = getDB();
  try {
    return db.prepare(`SELECT COUNT(*) as count FROM reminders WHERE sent_at IS NULL`).get().count;
  } catch (e) {
    return 0;
  }
}

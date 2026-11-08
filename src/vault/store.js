import { getDB, syncSqliteToJson } from './db.js';

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
  syncSqliteToJson();
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
  const res = db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
  syncSqliteToJson();
  return res;
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
  syncSqliteToJson();
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
  const res = db
    .prepare(`UPDATE reminders SET sent_at = ? WHERE id = ?`)
    .run(sentAt, id);
  syncSqliteToJson();
  return res;
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
  const res = db.prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
  syncSqliteToJson();
  return res;
}

export function deleteAllReminders(userId) {
  const db = getDB();
  let changes = 0;
  if (userId && userId !== '*') {
    const res = db.prepare(`DELETE FROM reminders WHERE sent_at IS NULL AND user_id = ?`).run(userId);
    changes = res?.changes || 0;
  } else {
    const res = db.prepare(`DELETE FROM reminders WHERE sent_at IS NULL`).run();
    changes = res?.changes || 0;
  }
  syncSqliteToJson();
  return changes;
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


// ── USER MEMORIES & KNOWLEDGE ───────────────────────────────────────────────
export function saveMemory({ userId, category = 'general', key, value }) {
  const db = getDB();
  const cleanKey = String(key || '').trim().toLowerCase();
  const cleanVal = String(value || '').trim();
  const cleanUser = userId || 'default_user';
  if (!cleanKey || !cleanVal) return null;

  const existing = db.prepare('SELECT id FROM memories WHERE user_id = ? AND key = ?').get(cleanUser, cleanKey);
  let id;
  if (existing) {
    db.prepare('UPDATE memories SET value = ?, category = ?, updated_at = ? WHERE id = ?')
      .run(cleanVal, category, new Date().toISOString(), existing.id);
    id = existing.id;
  } else {
    const res = db.prepare('INSERT INTO memories (user_id, category, key, value) VALUES (?, ?, ?, ?)')
      .run(cleanUser, category, cleanKey, cleanVal);
    id = res?.lastInsertRowid || 1;
  }
  syncSqliteToJson();
  return id;
}

export function listMemories(userId) {
  const db = getDB();
  const cleanUser = userId && userId !== '*' ? userId : null;
  if (cleanUser) {
    return db.prepare('SELECT id, category, key, value, updated_at FROM memories WHERE user_id = ? ORDER BY category, key ASC').all(cleanUser);
  }
  return db.prepare('SELECT id, category, key, value, updated_at FROM memories ORDER BY category, key ASC').all();
}

export function deleteMemory(userId, key) {
  const db = getDB();
  const cleanKey = String(key || '').trim().toLowerCase();
  const res = db.prepare('DELETE FROM memories WHERE user_id = ? AND key = ?').run(userId || 'default_user', cleanKey);
  syncSqliteToJson();
  return res?.changes || 0;
}

export function deleteAllMemories(userId) {
  const db = getDB();
  const res = db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId || 'default_user');
  syncSqliteToJson();
  return res?.changes || 0;
}

export function getMemoryCount(userId) {
  try {
    return listMemories(userId).length;
  } catch (e) {
    return 0;
  }
}

// ── MULTI-TURN CONVERSATION HISTORY (SLIDING WINDOW) ────────────────────────
export function recordConversation(userId, role, content) {
  const db = getDB();
  const cleanUser = userId || 'default_user';
  const cleanContent = String(content || '').trim();
  if (!cleanContent) return;

  try {
    db.prepare('INSERT INTO conversation_history (user_id, role, content) VALUES (?, ?, ?)')
      .run(cleanUser, role, cleanContent);

    // Keep only last 20 messages for this user
    const all = db.prepare('SELECT id FROM conversation_history WHERE user_id = ? ORDER BY created_at DESC').all(cleanUser);
    if (all.length > 20) {
      const oldestToKeep = all[19].id;
      db.prepare('DELETE FROM conversation_history WHERE user_id = ? AND id < ?').run(cleanUser, oldestToKeep);
    }
  } catch (e) {
    // Non-critical
  }

  syncSqliteToJson();
}

export function getRecentConversation(userId, limit = 10) {
  const db = getDB();
  const cleanUser = userId || 'default_user';
  try {
    const rows = db.prepare('SELECT role, content, created_at FROM conversation_history WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(cleanUser, limit);
    return rows.reverse();
  } catch (e) {
    return [];
  }
}

export function clearConversation(userId) {
  const db = getDB();
  const cleanUser = userId || 'default_user';
  try {
    const res = db.prepare('DELETE FROM conversation_history WHERE user_id = ?').run(cleanUser);
    syncSqliteToJson();
    return res?.changes || 0;
  } catch (e) {
    return 0;
  }
}

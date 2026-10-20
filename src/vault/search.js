import OpenAI from 'openai';
import { config } from '../config.js';
import { getAllWithEmbeddings } from './store.js';
import { getDB } from './db.js';

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient && config.openaiApiKey) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Generate an OpenAI text embedding for the given text.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text) {
  const client = getOpenAI();
  if (!client) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const res = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Semantic search over all vault items that have stored embeddings.
 * Returns top-K results with cosine similarity > 0.5.
 *
 * @param {string} query
 * @param {number} topK
 * @returns {Promise<object[]>}
 */
export async function semanticSearch(query, topK = 5) {
  const queryEmb = await getEmbedding(query);
  const items = getAllWithEmbeddings();

  const scored = items
    .map(item => ({
      ...item,
      score: cosineSim(queryEmb, JSON.parse(item.embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(i => i.score > 0.5);

  return scored;
}

/**
 * Synchronous keyword/LIKE search on content and tags.
 * Performs phrase search first, then token-based OR search.
 * @param {string} query
 * @returns {object[]}
 */
export function keywordSearch(query) {
  const db = getDB();
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  // 1. Direct substring match on content or tags
  const directMatches = db
    .prepare(
      `SELECT id, type, content, tags, is_secret, created_at
       FROM items WHERE content LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(`%${trimmed}%`, `%${trimmed}%`);

  if (directMatches.length > 0) {
    return directMatches;
  }

  // 2. Token-based fallback for multi-word queries
  const words = trimmed.split(/\s+/).filter(w => w.length >= 2);
  if (words.length > 1) {
    const conditions = words.map(() => `content LIKE ?`).join(' OR ');
    const params = words.map(w => `%${w}%`);
    return db
      .prepare(
        `SELECT id, type, content, tags, is_secret, created_at
         FROM items WHERE ${conditions} ORDER BY created_at DESC LIMIT 10`
      )
      .all(...params);
  }

  return [];
}

import { sendMessage } from './whatsapp/client.js';
import { classify } from './vault/classifier.js';
import { save, listRecent, deleteItem, getById } from './vault/store.js';
import { semanticSearch, getEmbedding, keywordSearch } from './vault/search.js';
import { encrypt, decrypt } from './vault/crypto.js';

const ICONS = { note: '📝', link: '🔗', secret: '🔐', file: '📎' };

/**
 * Main dispatcher — routes an inbound WhatsApp message to the correct vault action.
 *
 * @param {string} from     Sender phone number
 * @param {{ type: string, text?: string, mediaId?: string, mimeType?: string, caption?: string }} message
 */
export async function dispatch(from, message) {
  const { type: msgType, text, mediaId, mimeType, caption } = message;
  const trimmed = (text || '').trim();

  // ── list ──────────────────────────────────────────────────────────────────
  if (trimmed.toLowerCase() === 'list') {
    const items = listRecent(10);
    if (!items.length) return sendMessage(from, '🔒 Your vault is empty.');
    const lines = items.map(item => {
      const preview = item.is_secret ? '[🔐 Secret]' : item.content.slice(0, 60);
      return `[${item.id}] ${item.type.toUpperCase()} — ${preview}`;
    });
    return sendMessage(from, `📦 Last ${items.length} items:\n\n${lines.join('\n')}`);
  }

  // ── delete <id> ───────────────────────────────────────────────────────────
  const deleteMatch = trimmed.match(/^delete\s+(\d+)$/i);
  if (deleteMatch) {
    const id = parseInt(deleteMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, `❌ No item with ID ${id}`);
    deleteItem(id);
    return sendMessage(from, `🗑️ Deleted item #${id}`);
  }

  // ── get <id> (reveal secret or any item) ─────────────────────────────────
  const getMatch = trimmed.match(/^get\s+(\d+)$/i);
  if (getMatch) {
    const id = parseInt(getMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, `❌ No item with ID ${id}`);
    const content = item.is_secret ? decrypt(item.content) : item.content;
    return sendMessage(from, `🔑 #${id} (${item.type}):\n${content}`);
  }

  // ── media / file attachment ───────────────────────────────────────────────
  if (msgType !== 'text' && mediaId) {
    const id = save({
      type: 'file',
      content: caption || `File (${mimeType})`,
      tags: [],
      mediaId,
      mimeType,
    });
    return sendMessage(
      from,
      `📎 File saved! ID: #${id}\nType: ${mimeType}${caption ? `\nCaption: ${caption}` : ''}`
    );
  }

  // ── text processing ───────────────────────────────────────────────────────
  const { type, content, tags, isSearch } = await classify(trimmed);

  // Search intent
  if (isSearch) {
    await sendMessage(from, '🔍 Searching your vault...');

    // Extract core query by removing natural language trigger prefixes
    let cleanQuery = trimmed;
    const prefixes = [
      'find ',
      'search for ',
      'search ',
      'what did i save about ',
      'what did i save on ',
      'what did i save ',
      'where is ',
      'recall ',
      'show me ',
    ];
    for (const prefix of prefixes) {
      if (cleanQuery.toLowerCase().startsWith(prefix)) {
        cleanQuery = cleanQuery.slice(prefix.length).trim();
        break;
      }
    }
    cleanQuery = cleanQuery.replace(/\?+$/, '').trim() || trimmed;

    let semanticResults = [];
    try {
      semanticResults = await semanticSearch(cleanQuery);
    } catch (err) {
      // If OpenAI embedding is not available, gracefully use keyword search
      console.warn('Semantic search unavailable, using keyword fallback:', err.message);
    }

    if (semanticResults && semanticResults.length > 0) {
      const lines = semanticResults.map(r => {
        const preview = r.is_secret
          ? '[🔐 Secret — use `get <id>` to reveal]'
          : r.content.slice(0, 80);
        return `[${r.id}] ${r.type.toUpperCase()} — ${preview}`;
      });
      return sendMessage(from, `🧠 Found ${semanticResults.length} result(s):\n\n${lines.join('\n\n')}`);
    }

    // Fallback to keyword search
    const kwResults = keywordSearch(cleanQuery);
    if (kwResults.length > 0) {
      const lines = kwResults.map(r => {
        const preview = r.is_secret ? '[🔐 Secret]' : r.content.slice(0, 80);
        return `[${r.id}] ${r.type.toUpperCase()} — ${preview}`;
      });
      return sendMessage(from, `🔤 Keyword results for "${cleanQuery}":\n\n${lines.join('\n\n')}`);
    }

    return sendMessage(from, `🤷 Nothing found for: "${cleanQuery}"`);
  }

  // ── store item ────────────────────────────────────────────────────────────
  let storedContent = content;
  let isSecret = false;

  if (type === 'secret') {
    storedContent = encrypt(content);
    isSecret = true;
  }

  // Embed non-secret items for semantic search
  let embedding = null;
  if (!isSecret) {
    try {
      embedding = await getEmbedding(content);
    } catch (err) {
      console.warn('Embedding failed (will use keyword search only):', err.message);
    }
  }

  const id = save({ type, content: storedContent, tags, embedding, isSecret });

  const tagStr = tags.length ? `\nTags: ${tags.map(t => '#' + t).join(' ')}` : '';
  const icon = ICONS[type] || '📦';
  return sendMessage(from, `${icon} Saved! ID: #${id}${tagStr}`);
}

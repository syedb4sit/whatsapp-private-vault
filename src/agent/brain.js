import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { save, listRecent, deleteItem, getById } from '../vault/store.js';
import { keywordSearch } from '../vault/search.js';
import { encrypt, decrypt } from '../vault/crypto.js';

let genAI = null;

function getGenAI() {
  if (!genAI && config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

const SYSTEM_PROMPT = `
You are the intelligent brain of a secure personal memory vault assistant on WhatsApp.
Your job is to read the user's message, determine their intent, and return a single valid JSON object.

Available actions:
1. "save_secret": When the user wants to save passwords, PINs, bank details, API keys, private tokens, or confidential data.
   Required fields: "content" (the secret value), "label" (short title), "reply" (friendly confirmation)
2. "save_note": When the user wants to remember or save regular notes, ideas, reminders, tasks, links, or facts.
   Required fields: "content" (the text), "tags" (optional array of category strings), "reply" (friendly confirmation)
3. "search_vault": When the user asks a question about what they saved, asks where something is, or wants to recall something.
   Required fields: "query" (the keyword or topic to search)
4. "list_vault": When the user asks to see recent notes, list everything, or check their memory.
   Required fields: "reply"
5. "get_item": When the user asks for a specific note/secret by its numeric ID (e.g. "show me 3", "get item 1", "reveal password 2").
   Required fields: "id" (integer)
6. "delete_item": When the user asks to delete or forget a specific item by ID (e.g. "delete 2", "remove note 1").
   Required fields: "id" (integer)
7. "chat": General greetings, small talk, or questions about what you can do.
   Required fields: "reply"

Rules:
- NEVER leave passwords unencrypted; always classify them as "save_secret".
- Keep replies concise, helpful, and natural for WhatsApp with emojis.
`;

/**
 * Process a natural language message with Gemini.
 * Returns a conversational WhatsApp reply string.
 */
export async function processWithGemini(userText) {
  const client = getGenAI();
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-3.8-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const res = await model.generateContent(userText);
    const text = res.response.text();
    const parsed = JSON.parse(text);

    console.log(`🧠 [Gemini Intent] Action: ${parsed.action}`, parsed);

    // ── Execute Action ────────────────────────────────────────────────────────
    if (parsed.action === 'save_secret' && parsed.content) {
      const encrypted = encrypt(parsed.content);
      const tags = parsed.label ? [parsed.label.toLowerCase().replace(/\s+/g, '_')] : ['secret'];
      const id = save({
        type: 'secret',
        content: encrypted,
        tags,
        isSecret: true,
      });
      return `${parsed.reply || '🔐 Encrypted and saved to your private vault!'} (ID: #${id})`;
    }

    if (parsed.action === 'save_note' && parsed.content) {
      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      const id = save({
        type: 'note',
        content: parsed.content,
        tags,
      });
      const tagStr = tags.length ? `\nTags: ${tags.map(t => '#' + t).join(' ')}` : '';
      return `${parsed.reply || '📝 Saved to your vault!'} (ID: #${id})${tagStr}`;
    }

    if (parsed.action === 'search_vault' && parsed.query) {
      const results = keywordSearch(parsed.query);
      if (!results || results.length === 0) {
        return `🔍 I searched your vault for "${parsed.query}", but didn't find anything matching yet.`;
      }
      const lines = results.map(r => {
        const preview = r.is_secret
          ? '[🔐 Encrypted Secret — ask "reveal ' + r.id + '" to view]'
          : r.content.slice(0, 80);
        return `[#${r.id}] ${r.type.toUpperCase()}: ${preview}`;
      });
      return `🧠 Found ${results.length} item(s) for "${parsed.query}":\n\n${lines.join('\n\n')}`;
    }

    if (parsed.action === 'list_vault') {
      const items = listRecent(5);
      if (!items || items.length === 0) {
        return '🔒 Your vault is currently empty.';
      }
      const lines = items.map(item => {
        const preview = item.is_secret ? '[🔐 Secret]' : item.content.slice(0, 60);
        return `[#${item.id}] ${item.type.toUpperCase()} — ${preview}`;
      });
      return `📦 Recent items in your vault:\n\n${lines.join('\n')}`;
    }

    if (parsed.action === 'get_item' && parsed.id) {
      const item = getById(parsed.id);
      if (!item) return `❌ No item found with ID #${parsed.id}.`;
      const content = item.is_secret ? decrypt(item.content) : item.content;
      return `🔑 Item #${item.id} (${item.type}):\n${content}`;
    }

    if (parsed.action === 'delete_item' && parsed.id) {
      deleteItem(parsed.id);
      return `🗑️ Permanently removed item #${parsed.id} from your vault.`;
    }

    if (parsed.reply) {
      return parsed.reply;
    }

    return null;
  } catch (err) {
    console.warn('⚠️ Gemini reasoning error (falling back to direct parser):', err.message);
    return null;
  }
}

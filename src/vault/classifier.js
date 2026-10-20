import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const URL_REGEX = /https?:\/\/[^\s]+/g;

/**
 * Classify an incoming text message into a vault action descriptor.
 * @param {string} text
 * @returns {{ type: string|null, content: string, tags: string[], isSearch: boolean }}
 */
export async function classify(text) {
  // Fast local checks first

  // Secret store
  if (text.toLowerCase().startsWith('secret:')) {
    return { type: 'secret', content: text.slice(7).trim(), tags: [], isSearch: false };
  }

  // Pure URL
  const urls = text.match(URL_REGEX);
  if (urls && urls.length > 0 && text.trim() === urls[0]) {
    return { type: 'link', content: text.trim(), tags: [], isSearch: false };
  }

  // Extract #tags
  const tags = (text.match(/#\w+/g) || []).map(t => t.slice(1));

  // Check for search intent
  const searchTriggers = [
    'find ',
    'search ',
    'what did i save',
    'where is',
    'recall',
    'show me',
    'get ',
  ];
  const lowerText = text.toLowerCase();
  const isSearch =
    searchTriggers.some(t => lowerText.startsWith(t)) || text.endsWith('?');

  if (isSearch) {
    return { type: null, content: text, tags: [], isSearch: true };
  }

  // Default: note or link with additional content
  const type = urls ? 'link' : 'note';
  return { type, content: text, tags, isSearch: false };
}

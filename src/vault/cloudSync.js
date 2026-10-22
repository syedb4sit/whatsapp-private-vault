import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

let githubToken = process.env.GITHUB_BACKUP_TOKEN || process.env.GITHUB_TOKEN || null;
let gistId = process.env.GITHUB_GIST_ID || null;
let saveTimer = null;

const GIST_FILENAME = 'whatsapp_vault_backup.json';

/**
 * Configure cloud sync credentials dynamically if passed.
 */
export function configureCloudSync({ token, id }) {
  if (token) githubToken = token;
  if (id) gistId = id;
}

/**
 * Restore persistent database backup from GitHub Gist on startup.
 *
 * @param {string} localJsonPath
 * @returns {Promise<boolean>} True if restored successfully, false otherwise.
 */
export async function restoreFromCloud(localJsonPath) {
  if (!githubToken) {
    console.log('ℹ️  Cloud persistence sync: No GITHUB_BACKUP_TOKEN set. Using local file storage.');
    return false;
  }

  try {
    console.log('☁️  Checking cloud backup for previous memory, vault items & reminders...');
    const headers = {
      Authorization: `token ${githubToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'WhatsApp-Private-Vault',
    };

    let targetGist = null;

    if (gistId) {
      const res = await axios.get(`https://api.github.com/gists/${gistId}`, { headers, timeout: 10000 });
      targetGist = res.data;
    } else {
      // Find existing private backup gist
      const res = await axios.get('https://api.github.com/gists?per_page=50', { headers, timeout: 10000 });
      const gists = res.data || [];
      targetGist = gists.find(g => g.files && g.files[GIST_FILENAME]);
      if (targetGist) {
        gistId = targetGist.id;
        console.log(`☁️  Found existing vault backup Gist: ${gistId}`);
      }
    }

    if (targetGist && targetGist.files && targetGist.files[GIST_FILENAME]) {
      const fileData = targetGist.files[GIST_FILENAME];
      const content = fileData.content || (fileData.raw_url ? (await axios.get(fileData.raw_url, { timeout: 10000 })).data : null);

      if (content) {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        const itemCount = parsed.items?.length || (Array.isArray(parsed) ? parsed.length : 0);
        const remCount = parsed.reminders?.length || 0;

        fs.writeFileSync(localJsonPath, JSON.stringify(parsed, null, 2), 'utf8');
        console.log(`✅ Successfully restored from cloud backup! (${itemCount} vault items, ${remCount} reminders)`);
        return true;
      }
    } else {
      console.log('ℹ️  No cloud backup found yet. A fresh backup will be initialized on first write.');
    }
  } catch (err) {
    console.warn(`⚠️ Cloud backup restore failed (${err.message}). Continuing with local data.`);
  }

  return false;
}

/**
 * Sync the local database state to the cloud Gist.
 * Debounced to prevent excessive API calls on rapid writes.
 *
 * @param {string} localJsonPath
 */
export function scheduleCloudBackup(localJsonPath) {
  if (!githubToken) return;

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(async () => {
    try {
      if (!fs.existsSync(localJsonPath)) return;
      const raw = fs.readFileSync(localJsonPath, 'utf8');
      const headers = {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'WhatsApp-Private-Vault',
      };

      if (gistId) {
        // Update existing Gist
        await axios.patch(
          `https://api.github.com/gists/${gistId}`,
          {
            description: 'WhatsApp Private Vault Persistent State Backup',
            files: {
              [GIST_FILENAME]: {
                content: raw,
              },
            },
          },
          { headers, timeout: 10000 }
        );
        console.log(`☁️  Persistent state backup updated in Gist (${gistId})`);
      } else {
        // Create new private Gist
        const res = await axios.post(
          'https://api.github.com/gists',
          {
            description: 'WhatsApp Private Vault Persistent State Backup',
            public: false,
            files: {
              [GIST_FILENAME]: {
                content: raw,
              },
            },
          },
          { headers, timeout: 10000 }
        );
        if (res.data?.id) {
          gistId = res.data.id;
          console.log(`☁️  Created new private vault backup Gist: ${gistId}`);
        }
      }
    } catch (err) {
      console.warn('⚠️ Cloud backup sync failed:', err.message);
    }
  }, 3000); // 3 second debounce
}

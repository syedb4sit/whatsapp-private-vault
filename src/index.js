import express from 'express';
import { config } from './config.js';
import { initDB } from './vault/db.js';
import { getCount, listRecent } from './vault/store.js';
import { handleInbound } from './whatsapp/handler.js';
import { dispatch } from './router.js';
import { startAgentPoller } from './whatsapp/agentPoller.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Root Web Dashboard & Status ───────────────────────────────────────────
app.get('/', (req, res) => {
  let count = 0;
  let items = [];
  try {
    count = getCount();
    items = listRecent(5);
  } catch (e) {}

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔒 WhatsApp Private Vault MVP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.5; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; background: #059669; color: white; }
    .stat { font-size: 2.2rem; font-weight: bold; color: #38bdf8; margin: 0.5rem 0; }
    input, button { padding: 0.75rem; border-radius: 8px; border: 1px solid #475569; font-size: 1rem; }
    input { background: #0f172a; color: white; width: 70%; }
    button { background: #2563eb; color: white; font-weight: bold; cursor: pointer; border: none; margin-left: 0.5rem; }
    button:hover { background: #1d4ed8; }
    pre { background: #090d16; padding: 1rem; border-radius: 8px; overflow-x: auto; color: #a5f3fc; }
    ul { list-style: none; padding: 0; }
    li { background: #0f172a; padding: 0.75rem; margin-bottom: 0.5rem; border-radius: 6px; font-family: monospace; }
  </style>
</head>
<body>
  <h1>🔒 WhatsApp Private Vault MVP</h1>
  <div class="card">
    <span class="badge">Online & Ready</span>
    <div class="stat">${count}</div>
    <div style="color: #94a3b8;">Total Items Stored in Encrypted Vault</div>
  </div>

  <div class="card">
    <h3>🧪 Test Interactive Simulator</h3>
    <p style="color: #94a3b8; font-size: 0.9rem;">Test commands like: <code>secret: my pass 123</code>, <code>list</code>, <code>find pass</code>, <code>buy milk #todo</code></p>
    <form id="simForm">
      <input type="text" id="simText" placeholder="Type a message or command..." required />
      <button type="submit">Send</button>
    </form>
    <div id="simResult" style="margin-top: 1rem; display: none;">
      <strong>Response:</strong>
      <pre id="simOutput"></pre>
    </div>
  </div>

  <div class="card">
    <h3>📋 Recent Vault Items</h3>
    <ul>
      ${items.length === 0 ? '<li style="color:#64748b;">Vault is currently empty.</li>' : items.map(i => `<li>[#${i.id}] ${i.type.toUpperCase()} - ${i.is_secret ? '🔐 [Encrypted AES-256 Secret]' : (i.content || '').slice(0, 50)}</li>`).join('')}
    </ul>
  </div>

  <div class="card">
    <h3>🔗 Webhook Configuration</h3>
    <p><strong>Callback URL:</strong> <code>https://${req.headers.host || 'your-service.onrender.com'}/webhook</code></p>
    <p><strong>Verify Token:</strong> <code>${config.webhookVerifyToken}</code></p>
  </div>

  <script>
    document.getElementById('simForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.getElementById('simText').value;
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, from: 'web-user' })
      });
      const data = await res.json();
      document.getElementById('simResult').style.display = 'block';
      document.getElementById('simOutput').textContent = data.reply || JSON.stringify(data, null, 2);
    });
  </script>
</body>
</html>
  `);
});

// ── WhatsApp webhook verification ─────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.webhookVerifyToken) {
    console.log('Webhook verified ✅');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Inbound messages (from WhatsApp or external agent) ─────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately so WhatsApp doesn't retry
  console.log('📨 Webhook event received from WhatsApp:', JSON.stringify(req.body));
  try {
    await handleInbound(req.body);
  } catch (err) {
    console.error('Handler error:', err);
  }
});

// ── Direct Interactive Test Endpoint ───────────────────────────────────────
app.post('/api/test', async (req, res) => {
  const { text, from = 'tester' } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing text in body' });
  }

  let capturedReply = '';
  // Temporary intercept console / reply for this test call
  try {
    // Intercept client send to return reply in HTTP JSON response
    const originalConsoleLog = console.log;
    let replyLogs = [];
    console.log = (...args) => {
      replyLogs.push(args.join(' '));
      originalConsoleLog.apply(console, args);
    };

    await dispatch(from, { type: 'text', text });
    console.log = originalConsoleLog;

    const fullLog = replyLogs.join('\n');
    res.json({ success: true, text, reply: fullLog || 'Processed successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const items = getCount();
    res.json({ status: 'ok', items, nodeVersion: process.version });
  } catch {
    res.json({ status: 'ok', items: 0 });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────
initDB();
startAgentPoller();
app.listen(config.port, () =>
  console.log(`🔒 Vault server running on port ${config.port}`)
);

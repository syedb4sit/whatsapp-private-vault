import express from 'express';
import { config } from './config.js';
import { initDB, initCloudSync } from './vault/db.js';
import { getCount, listRecent, getReminderCount, listUpcomingReminders } from './vault/store.js';
import { handleInbound } from './whatsapp/handler.js';
import { dispatch } from './router.js';
import { startAgentPoller } from './whatsapp/agentPoller.js';
import { startReminderScheduler } from './agent/scheduler.js';
import { initLogCapture, getRecentLogs, pollerStatus, clientStatus, webhookStatus } from './utils/status.js';

// Start recording in-memory logs for diagnostics
initLogCapture();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Root Web Dashboard & Status ───────────────────────────────────────────
app.get('/', (req, res) => {
  let count = 0;
  let reminderCount = 0;
  let items = [];
  let pendingReminders = [];
  try {
    count = getCount();
    reminderCount = getReminderCount();
    items = listRecent(5);
    pendingReminders = listUpcomingReminders();
  } catch (e) {}

  const hasToken = Boolean(config.whatsappToken && !config.whatsappToken.includes('your_token'));
  const tokenMasked = hasToken ? (config.whatsappToken.slice(0, 10) + '...' + config.whatsappToken.slice(-6)) : 'None (Using Console Simulation)';
  const recentLogsList = getRecentLogs(25);

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔒 WhatsApp Private Vault & Proactive Agent</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 850px; margin: 0 auto; line-height: 1.5; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; background: #059669; color: white; }
    .badge-warn { background: #d97706; }
    .badge-err { background: #dc2626; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .stat { font-size: 2.2rem; font-weight: bold; color: #38bdf8; margin: 0.5rem 0; }
    input, button { padding: 0.75rem; border-radius: 8px; border: 1px solid #475569; font-size: 1rem; }
    input { background: #0f172a; color: white; width: 70%; }
    button { background: #2563eb; color: white; font-weight: bold; cursor: pointer; border: none; margin-left: 0.5rem; }
    button:hover { background: #1d4ed8; }
    pre { background: #090d16; padding: 1rem; border-radius: 8px; overflow-x: auto; color: #a5f3fc; font-size: 0.85rem; line-height: 1.4; }
    ul { list-style: none; padding: 0; }
    li { background: #0f172a; padding: 0.75rem; margin-bottom: 0.5rem; border-radius: 6px; font-family: monospace; }
    .status-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #334155; }
  </style>
</head>
<body>
  <h1>🔒 WhatsApp Private Vault & Proactive Agent</h1>
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span class="badge">Online & Proactive</span>
      <span class="badge ${pollerStatus.state === 'auth_error' ? 'badge-err' : (pollerStatus.state === 'polling' || pollerStatus.state === 'connected' ? '' : 'badge-warn')}">
        Agent Poller: ${pollerStatus.state.toUpperCase()}
      </span>
    </div>
    <div class="stats-grid" style="margin-top:1rem;">
      <div>
        <div class="stat">${count}</div>
        <div style="color: #94a3b8;">Total Items Stored</div>
      </div>
      <div>
        <div class="stat" style="color: #fbbf24;">${reminderCount}</div>
        <div style="color: #94a3b8;">Active Scheduled Reminders</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>📡 WhatsApp Connection Diagnostics</h3>
    <div class="status-row">
      <span>WhatsApp Token:</span>
      <code>${tokenMasked}</code>
    </div>
    <div class="status-row">
      <span>Poller State:</span>
      <strong>${pollerStatus.state} (HTTP ${pollerStatus.lastHttpStatus || 'N/A'})</strong>
    </div>
    <div class="status-row">
      <span>Last Poll Timestamp:</span>
      <span>${pollerStatus.lastPollAt || 'None'}</span>
    </div>
    <div class="status-row">
      <span>Total Messages Received:</span>
      <span>${pollerStatus.totalMessagesReceived + webhookStatus.totalReceived}</span>
    </div>
    <div class="status-row">
      <span>Last Inbound Message:</span>
      <span>${pollerStatus.lastMessageSnippet || webhookStatus.lastSnippet || 'None'}</span>
    </div>
    <div class="status-row">
      <span>Last Outbound Reply:</span>
      <span>${clientStatus.lastStatus ? clientStatus.lastStatus.toUpperCase() : 'None'} (${clientStatus.lastSentAt || 'None'})</span>
    </div>
    ${pollerStatus.lastError ? `<div style="margin-top:0.75rem; color:#f87171;"><strong>Last Poller Error:</strong> <pre>${JSON.stringify(pollerStatus.lastError, null, 2)}</pre></div>` : ''}
    ${clientStatus.lastError ? `<div style="margin-top:0.75rem; color:#f87171;"><strong>Last Outbound Error:</strong> <pre>${JSON.stringify(clientStatus.lastError, null, 2)}</pre></div>` : ''}
  </div>

  <div class="card">
    <h3>🧪 Test Interactive Simulator</h3>
    <p style="color: #94a3b8; font-size: 0.9rem;">
      Try reminders: <code>remind me in 10 minutes to take medicine</code>, <code>reminders</code><br>
      Try notes/secrets: <code>secret: my pass 123</code>, <code>find pass</code>
    </p>
    <form id="simForm">
      <input type="text" id="simText" placeholder="Type a message or command..." required />
      <button type="submit">Send</button>
    </form>
    <div id="simResult" style="margin-top: 1rem; display: none;">
      <strong>Agent Response:</strong>
      <pre id="simOutput"></pre>
    </div>
  </div>

  <div class="card">
    <h3>⏰ Upcoming Scheduled Reminders</h3>
    <ul>
      ${pendingReminders.length === 0 ? '<li style="color:#64748b;">No pending reminders.</li>' : pendingReminders.map(r => `<li>[#${r.id}] ⏰ ${new Date(r.due_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit', hour12: true })} PKT: "${r.content}"</li>`).join('')}
    </ul>
  </div>

  <div class="card">
    <h3>📜 Recent Server Logs (Live Diagnostics)</h3>
    <pre style="max-height: 250px; overflow-y: auto;">${recentLogsList.join('\n') || 'No logs recorded yet.'}</pre>
    <div style="margin-top: 0.5rem; text-align: right;">
      <a href="/api/status" target="_blank" style="color: #38bdf8; font-size: 0.85rem;">View JSON Diagnostics (/api/status)</a>
    </div>
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

  try {
    const originalConsoleLog = console.log;
    let replyLogs = [];
    console.log = (...args) => {
      replyLogs.push(args.join(' '));
      originalConsoleLog.apply(console, args);
    };

    const replyResult = await dispatch(from, { type: 'text', text });
    console.log = originalConsoleLog;

    const fullLog = replyLogs.join('\n');
    res.json({
      success: true,
      text,
      reply: replyResult?.text?.body || replyResult?.body || fullLog || 'Processed successfully!',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Full System Diagnostics Endpoint ──────────────────────────────────────
app.get('/api/status', (req, res) => {
  const hasToken = Boolean(config.whatsappToken && !config.whatsappToken.includes('your_token'));
  res.json({
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    tokenConfigured: hasToken,
    tokenPrefix: hasToken ? config.whatsappToken.slice(0, 8) + '...' : 'none',
    tokenLength: config.whatsappToken ? config.whatsappToken.length : 0,
    geminiConfigured: Boolean(config.geminiApiKey),
    poller: pollerStatus,
    client: clientStatus,
    webhook: webhookStatus,
    items: getCount(),
    reminders: getReminderCount(),
    recentLogs: getRecentLogs(50),
  });
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const items = getCount();
    const reminders = getReminderCount();
    res.json({
      status: 'ok',
      items,
      reminders,
      pollerState: pollerStatus.state,
      tokenConfigured: Boolean(config.whatsappToken && !config.whatsappToken.includes('your_token')),
      nodeVersion: process.version,
    });
  } catch {
    res.json({ status: 'ok', items: 0, reminders: 0 });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────
initDB();
await initCloudSync();
startAgentPoller();
startReminderScheduler();

const server = app.listen(config.port, () =>
  console.log(`🔒 Vault server running on port ${config.port}`)
);

// ── Self Keep-Alive Pinger (Prevents Render Free Tier Cold Sleep) ───────────
const publicUrl =
  process.env.RENDER_EXTERNAL_URL ||
  'https://whatsapp-private-vault.onrender.com';

if (publicUrl) {
  console.log(`⏱️ Keep-Alive pinger active for ${publicUrl} (every 10 minutes)`);
  setInterval(async () => {
    try {
      const res = await fetch(`${publicUrl}/health`);
      console.log(`💓 Keep-Alive ping dispatched (status ${res.status}).`);
    } catch (e) {
      console.warn('⚠️ Keep-Alive ping blip:', e.message);
    }
  }, 10 * 60 * 1000);
}

const MAX_LOGS = 100;
const logs = [];

export const pollerStatus = {
  isStarted: false,
  state: 'idle', // 'idle' | 'polling' | 'success' | 'auth_error' | 'rate_limited' | 'error'
  lastPollAt: null,
  lastHttpStatus: null,
  lastError: null,
  consecutiveErrors: 0,
  totalPolls: 0,
  totalMessagesReceived: 0,
  lastMessageAt: null,
  lastSender: null,
  lastMessageSnippet: null,
};

export const clientStatus = {
  totalSent: 0,
  lastSentAt: null,
  lastRecipient: null,
  lastStatus: null, // 'success' | 'error' | 'simulated'
  lastError: null,
};

export const webhookStatus = {
  totalReceived: 0,
  lastReceivedAt: null,
  lastSender: null,
  lastSnippet: null,
};

/**
 * Capture console logs in memory for live remote diagnostics.
 */
export function initLogCapture() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  function pushLog(level, args) {
    const time = new Date().toLocaleTimeString('en-US', {
      timeZone: 'Asia/Karachi',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    const text = args
      .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    logs.push(`[${time} PKT] [${level}] ${text}`);
    if (logs.length > MAX_LOGS) logs.shift();
  }

  console.log = (...args) => {
    pushLog('LOG', args);
    origLog.apply(console, args);
  };
  console.warn = (...args) => {
    pushLog('WARN', args);
    origWarn.apply(console, args);
  };
  console.error = (...args) => {
    pushLog('ERROR', args);
    origError.apply(console, args);
  };
}

export function getRecentLogs(count = 50) {
  return logs.slice(-count);
}

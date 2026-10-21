import { getDueReminders, markReminderSent } from '../vault/store.js';
import { sendMessage } from '../whatsapp/client.js';

let schedulerInterval = null;
let isChecking = false;

/**
 * Check for due reminders and dispatch clean, understated WhatsApp alerts.
 */
export async function checkAndDispatchReminders() {
  if (isChecking) return;
  isChecking = true;

  try {
    const nowIso = new Date().toISOString();
    const dueList = getDueReminders(nowIso);

    if (dueList && dueList.length > 0) {
      console.log(`⏰ [Reminder Engine] Found ${dueList.length} due reminder(s) to dispatch!`);

      for (const item of dueList) {
        // Mark as sent immediately to prevent double firing on network delays
        markReminderSent(item.id, nowIso);

        let scheduledTimeStr = '';
        try {
          scheduledTimeStr =
            new Date(item.due_at).toLocaleTimeString('en-US', {
              timeZone: 'Asia/Karachi',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            }) + ' PKT';
        } catch (e) {
          scheduledTimeStr = item.due_at;
        }

        const alertMessage =
          `*Reminder:*\n\n` +
          `• ${item.content}\n\n` +
          `_${scheduledTimeStr}_`;

        console.log(`🔔 [Reminder Engine] Sending alert to ${item.user_id}: "${item.content}"`);

        try {
          await sendMessage(item.user_id, alertMessage);
        } catch (sendErr) {
          console.error(`❌ Failed to send reminder alert:`, sendErr.message);
        }
      }
    }
  } catch (err) {
    console.error('⚠️ [Reminder Engine] Error checking due reminders:', err.message);
  } finally {
    isChecking = false;
  }
}

/**
 * Start the background reminder scheduler loop (polls every 15 seconds).
 */
export function startReminderScheduler(pollIntervalMs = 15000) {
  if (schedulerInterval) return;

  console.log(`⏰ [Reminder Engine] Background scheduler started (polling every ${pollIntervalMs / 1000}s)`);

  // Run initial check immediately
  checkAndDispatchReminders();

  schedulerInterval = setInterval(() => {
    checkAndDispatchReminders();
  }, pollIntervalMs);
}

/**
 * Stop the scheduler (useful for tests or graceful shutdown)
 */
export function stopReminderScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('⏰ [Reminder Engine] Background scheduler stopped.');
  }
}

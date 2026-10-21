import { initDB } from '../src/vault/db.js';
import {
  saveReminder,
  getDueReminders,
  markReminderSent,
  listUpcomingReminders,
  deleteReminder,
  getReminderCount,
  save,
  listRecent
} from '../src/vault/store.js';
import { processWithGemini } from '../src/agent/brain.js';
import { checkAndDispatchReminders } from '../src/agent/scheduler.js';

async function runTests() {
  console.log('--- 🧪 STARTING UNIT & INTEGRATION TESTS ---');

  initDB();

  // Test 1: Store reminder directly
  const futureIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const pastIso = new Date(Date.now() - 1000).toISOString();

  const id1 = saveReminder({
    userId: 'user:test12345',
    content: 'Call supervisor about Phase 2',
    dueAt: futureIso,
  });
  console.log(`✅ Test 1: Saved future reminder ID #${id1}`);

  const id2 = saveReminder({
    userId: 'user:test12345',
    content: 'Check tea in kettle',
    dueAt: pastIso,
  });
  console.log(`✅ Test 2: Saved due reminder ID #${id2}`);

  // Test 3: List upcoming
  const upcoming = listUpcomingReminders('user:test12345');
  console.log(`✅ Test 3: Upcoming reminders count: ${upcoming.length}`);

  // Test 4: Scheduler check (should find id2 and dispatch)
  console.log('Testing scheduler dispatch:');
  await checkAndDispatchReminders();

  // Verify id2 is marked sent
  const dueAfter = getDueReminders();
  console.log(`✅ Test 4: Remaining due reminders after dispatch: ${dueAfter.length} (should be 0)`);

  // Test 5: Gemini Natural Language Intent Reasoning
  console.log('\n--- 🧠 TESTING GEMINI 3.8 FLASH REASONING & INTENT DISAMBIGUATION ---');

  console.log('\n1. Test: "Remind me in 10 minutes to take medicine"');
  const res1 = await processWithGemini('Remind me in 10 minutes to take medicine', 'user:test12345');
  console.log('Gemini Reply:', res1);

  console.log('\n2. Test: "What reminders do I have?"');
  const res2 = await processWithGemini('What reminders do I have?', 'user:test12345');
  console.log('Gemini Reply:', res2);

  console.log('\n3. Test: "I parked my bike at gate 4"');
  const res3 = await processWithGemini('I parked my bike at gate 4', 'user:test12345');
  console.log('Gemini Reply:', res3);

  console.log('\n4. Test: "What did I save about my bike?"');
  const res4 = await processWithGemini('What did I save about my bike?', 'user:test12345');
  console.log('Gemini Reply:', res4);

  console.log('\n5. Test: "secret: server root pass is SuperSecret99!"');
  const res5 = await processWithGemini('save secret: server root pass is SuperSecret99!', 'user:test12345');
  console.log('Gemini Reply:', res5);

  console.log('\n✅ ALL TESTS FINISHED!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});

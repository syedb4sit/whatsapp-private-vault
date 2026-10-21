import { initDB } from '../src/vault/db.js';
import {
  saveReminder,
  listUpcomingReminders,
  deleteAllReminders,
} from '../src/vault/store.js';
import { processWithGemini } from '../src/agent/brain.js';

async function testNaturalCancel() {
  console.log('--- 🧪 TESTING NATURAL LANGUAGE REMINDER CANCELLATION ---');
  initDB();

  const testUser = 'user:tester_natural_cancel';
  // Clear any existing reminders for this user
  deleteAllReminders(testUser);

  // Setup 3 reminders
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 5);

  const friday = new Date();
  friday.setDate(friday.getDate() + 2);

  const idMeeting = saveReminder({
    userId: testUser,
    content: 'Meeting with supervisor Dr. Sajid',
    dueAt: tomorrow.toISOString(),
  });
  console.log(`Created meeting reminder ID #${idMeeting} (Tomorrow 10am)`);

  const idBirthday = saveReminder({
    userId: testUser,
    content: "Buy Mom's birthday gift and cake",
    dueAt: nextWeek.toISOString(),
  });
  console.log(`Created birthday reminder ID #${idBirthday} (Next week)`);

  const idDentist = saveReminder({
    userId: testUser,
    content: 'Dentist appointment with Dr. Smith',
    dueAt: friday.toISOString(),
  });
  console.log(`Created dentist reminder ID #${idDentist} (Friday)`);

  console.log('\n--- 1. Testing: "cancel meeting reminder for tomorrow" ---');
  const res1 = await processWithGemini('cancel meeting reminder for tomorrow', testUser);
  console.log('Result 1:\n', res1);

  console.log('\n--- 2. Testing: "cancel birthday reminder" ---');
  const res2 = await processWithGemini('cancel birthday reminder', testUser);
  console.log('Result 2:\n', res2);

  console.log('\n--- 3. Testing: "what reminders do I have?" (Should only have dentist) ---');
  const res3 = await processWithGemini('what reminders do I have?', testUser);
  console.log('Result 3:\n', res3);

  console.log('\n--- 4. Testing: "remove dentist reminder" ---');
  const res4 = await processWithGemini('remove dentist reminder', testUser);
  console.log('Result 4:\n', res4);

  console.log('\n--- 5. Verify all are now gone ---');
  const remaining = listUpcomingReminders(testUser);
  console.log(`Remaining reminders: ${remaining.length} (Expected: 0)`);

  if (remaining.length === 0) {
    console.log('\n🎉 ALL NATURAL CANCEL TESTS PASSED SUCCESSFULLY!');
  } else {
    console.error('❌ Failed: Some reminders were not cancelled:', remaining);
    process.exit(1);
  }
}

testNaturalCancel().catch(e => {
  console.error('Error during test:', e);
  process.exit(1);
});

import { initDB } from '../src/vault/db.js';
import { processWithGemini } from '../src/agent/brain.js';
import { textToSpeech } from '../src/whatsapp/tts.js';
import { transcribeAudio } from '../src/whatsapp/transcriber.js';
import { dispatch } from '../src/router.js';
import { listUpcomingReminders, deleteAllReminders } from '../src/vault/store.js';

async function testVoiceAndProfile() {
  console.log('--- 🧪 TESTING BASIT PROFILE & SCHEDULE INTELLIGENCE ---');
  initDB();

  const testUser = 'user:test_basit';
  deleteAllReminders(testUser);

  // ── Test 1: Office Routine Knowledge ──────────────────────────────────────
  console.log('\n1. Test: "When do I leave for the office today?"');
  const resOffice = await processWithGemini('When do I leave for the office today?', testUser);
  console.log('Reply:', resOffice);

  // ── Test 2: University Routine Knowledge ──────────────────────────────────
  console.log('\n2. Test: "When do I go to university and when do I come home?"');
  const resUni = await processWithGemini('When do I go to university and when do I come home?', testUser);
  console.log('Reply:', resUni);

  // ── Test 3: Upcoming Exam Knowledge ───────────────────────────────────────
  console.log('\n3. Test: "When is my first exam?"');
  const resExam = await processWithGemini('When is my first exam?', testUser);
  console.log('Reply:', resExam);

  // ── Test 4: End-to-End Voice Note Processing ──────────────────────────────
  console.log('\n--- 🎙️ TESTING INTELLIGENT INBOUND VOICE NOTE PIPELINE ---');

  console.log('Generating audio speech file...');
  const audioPath = await textToSpeech('Remind me tomorrow at 9 AM to review for my exam');
  console.log('Generated audio at:', audioPath);

  if (audioPath) {
    console.log('Transcribing audio with Gemini...');
    const transcribed = await transcribeAudio(audioPath, 'audio/mp3');
    console.log('Transcribed Text:', transcribed);

    console.log('\nDispatching audio message through router...');
    await dispatch(testUser, {
      type: 'audio',
      filePath: audioPath,
      mimeType: 'audio/mp3',
    });

    const pending = listUpcomingReminders(testUser);
    console.log(`\nVerified Reminders Created from Voice Note: ${pending.length}`);
    if (pending.length > 0) {
      console.log('Created Reminder Content:', pending[0].content);
      console.log('Due At:', pending[0].due_at);
    }
  }

  console.log('\n🎉 ALL VOICE & PROFILE INTELLIGENCE TESTS COMPLETE!');
  process.exit(0);
}

testVoiceAndProfile().catch(e => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});

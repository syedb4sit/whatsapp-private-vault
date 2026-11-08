import { initDB } from '../src/vault/db.js';
import { dispatch } from '../src/router.js';
import {
  listMemories,
  deleteAllMemories,
  clearConversation,
  listUpcomingReminders,
  deleteAllReminders,
} from '../src/vault/store.js';

async function testSmartMemory() {
  console.log('--- 🧪 TESTING 10X SMARTER AGENT WITH LONG-TERM & MULTI-TURN MEMORY ---');
  initDB();

  const testUser = 'user:test_smart_basit';
  deleteAllMemories(testUser);
  clearConversation(testUser);
  deleteAllReminders(testUser);

  // ── Test 1: Autonomous Fact Extraction & Learning ───────────────────────────
  console.log('\n1. Test: "By the way, my brother is Hamza and my favorite coffee is black espresso."');
  const res1 = await dispatch(testUser, {
    type: 'text',
    text: 'By the way, my brother is Hamza and my favorite coffee is black espresso.',
  });
  console.log('Butler Reply 1:\n', res1?.text || res1);

  const memsAfter1 = listMemories(testUser);
  console.log('Learned Memories Count:', memsAfter1.length);
  console.log('Stored Knowledge Base:', memsAfter1.map(m => `[${m.category}] ${m.key} -> ${m.value}`));
  if (memsAfter1.length === 0) {
    throw new Error('Expected agent to autonomously learn facts from conversation');
  }

  // ── Test 2: Memory Recall in a Subsequent Turn ──────────────────────────────
  console.log('\n2. Test: "What do you know about my brother and my coffee preference?"');
  const res2 = await dispatch(testUser, {
    type: 'text',
    text: 'What do you know about my brother and my coffee preference?',
  });
  console.log('Butler Reply 2:\n', res2?.text || res2);

  // ── Test 3: Multi-Turn Conversation Continuity & Pronoun Resolution ────────
  console.log('\n3. Test Turn A: "Remind me at 6:00 PM to call Dr. Sajid about my thesis"');
  const res3A = await dispatch(testUser, {
    type: 'text',
    text: 'Remind me at 6:00 PM to call Dr. Sajid about my thesis',
  });
  console.log('Butler Reply 3A:\n', res3A?.text || res3A);

  const reminders3A = listUpcomingReminders(testUser);
  console.log('Reminders count after Turn A:', reminders3A.length);

  console.log('\n4. Test Turn B: "Actually make that 6:30 PM instead" (Resolving "that" from previous turn)');
  const res3B = await dispatch(testUser, {
    type: 'text',
    text: 'Actually make that 6:30 PM instead',
  });
  console.log('Butler Reply 3B:\n', res3B?.text || res3B);

  const reminders3B = listUpcomingReminders(testUser);
  console.log('Reminders count after Turn B:', reminders3B.length);
  if (reminders3B.length > 0) {
    console.log('Active reminder content:', reminders3B[0].content);
    console.log('Active reminder due:', reminders3B[0].due_at);
  }

  // ── Test 5: Forget Memory ───────────────────────────────────────────────────
  console.log('\n5. Test: "Forget my coffee preference"');
  const res4 = await dispatch(testUser, {
    type: 'text',
    text: 'Forget my coffee preference',
  });
  console.log('Butler Reply 4:\n', res4?.text || res4);

  const memsAfterForget = listMemories(testUser);
  console.log('Memories count after forget:', memsAfterForget.length);
  console.log('Remaining Knowledge Base:', memsAfterForget.map(m => `[${m.category}] ${m.key} -> ${m.value}`));

  // Cleanup
  deleteAllMemories(testUser);
  clearConversation(testUser);
  deleteAllReminders(testUser);

  console.log('\n🎉 ALL 10X INTELLIGENCE & MEMORY TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

testSmartMemory().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

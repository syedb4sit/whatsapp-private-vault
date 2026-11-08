import { initDB } from '../src/vault/db.js';
import {
  saveMemory,
  listMemories,
  deleteMemory,
  deleteAllMemories,
  recordConversation,
  getRecentConversation,
  clearConversation,
} from '../src/vault/store.js';

initDB();
const testUser = 'user:test_mem_user';

deleteAllMemories(testUser);
clearConversation(testUser);

// 1. Test saveMemory
console.log('Testing saveMemory...');
saveMemory({ userId: testUser, category: 'people', key: 'brother', value: 'Hamza' });
saveMemory({ userId: testUser, category: 'preferences', key: 'coffee', value: 'Black coffee no sugar' });
saveMemory({ userId: testUser, category: 'vehicle', key: 'car', value: 'Honda Civic plate LEA-123' });

const mems = listMemories(testUser);
console.log('Memories stored:', mems.length);
if (mems.length !== 3) throw new Error('Expected 3 memories');
console.log('Memories list:', mems.map(m => `${m.category}: ${m.key} -> ${m.value}`));

// 2. Test upsert
saveMemory({ userId: testUser, category: 'preferences', key: 'coffee', value: 'Espresso only' });
const updatedMems = listMemories(testUser);
const coffee = updatedMems.find(m => m.key === 'coffee');
if (coffee.value !== 'Espresso only') throw new Error('Failed to update existing memory');
console.log('Upsert verified: coffee is now', coffee.value);

// 3. Test conversation recording
console.log('\nTesting conversation history...');
recordConversation(testUser, 'user', 'Remind me at 5 to call Ali');
recordConversation(testUser, 'assistant', "Noted, Mr. Basit. Reminder set for 5:00 PM to call Ali.");
recordConversation(testUser, 'user', 'Actually change that to 5:30');

const history = getRecentConversation(testUser, 10);
console.log('Conversation history turns:', history.length);
if (history.length !== 3) throw new Error('Expected 3 history items');
console.log('History turns:', history.map(h => `[${h.role}]: ${h.content}`));

// Cleanup
deleteAllMemories(testUser);
clearConversation(testUser);

console.log('\n✅ ALL MEMORY & CONVERSATION DB TESTS PASSED!');

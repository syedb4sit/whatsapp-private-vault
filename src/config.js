import dotenv from 'dotenv';
dotenv.config();

export const config = {
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'fb708706ee0bd33ff93426d7',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  encryptionKey: (process.env.VAULT_ENCRYPTION_KEY || '55f601100915348404be44743c82a2fa').padEnd(32).slice(0, 32),
  ownerPhone: process.env.OWNER_PHONE || '*',
  port: parseInt(process.env.PORT || '3000', 10),
};

console.log('⚙️  Configuration loaded:');
console.log(`   - Owner restriction: ${config.ownerPhone === '*' ? 'Open (any sender allowed for MVP)' : config.ownerPhone}`);
console.log(`   - Webhook verify token: ${config.webhookVerifyToken}`);
console.log(`   - Vault encryption: AES-256-GCM initialized ✅`);
console.log(`   - OpenAI semantic search: ${config.openaiApiKey ? 'Enabled' : 'Disabled (using fast keyword/tag search fallback)'}`);
console.log(`   - Gemini AI reasoning: ${config.geminiApiKey ? 'Enabled ✅ (natural language tool-calling active)' : 'Disabled (using manual command keywords)'}`);
console.log(`   - WhatsApp API token: ${config.whatsappToken && !config.whatsappToken.includes('your_token') ? 'Configured ✅' : 'Pending (simulated output in console)'}`);

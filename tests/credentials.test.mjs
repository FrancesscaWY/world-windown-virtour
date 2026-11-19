import test from 'node:test';
import assert from 'node:assert/strict';
import { initialConfig } from '../server/ai/config.ts';
import { createApp } from '../server/app.ts';

test('Chat configuration loads environment keys without copying them to public config', async t => {
  const env = { CHAT_API_KEY: 'private-chat-fixture', DASHSCOPE_API_KEY: 'private-audio-fixture', CHAT_BASE_URL: 'https://8.8.8.8/v1', CHAT_MODEL: 'chosen-model' };
  const config = initialConfig(env);
  assert.equal(config.mode, 'live');
  assert.equal(config.text.apiKey, 'private-chat-fixture');
  assert.equal(config.audio.apiKey, 'private-audio-fixture');
  assert.equal(config.text.baseUrl, env.CHAT_BASE_URL); assert.equal(config.text.model, 'chosen-model');
  assert.equal(initialConfig({ ...env, CHAT_API_KEY: 'process-key' }).text.apiKey, 'process-key');
  const app = createApp({ env }); t.after(() => app.close());
  const status = await app.inject('/api/status');
  assert.equal(status.json().mode, 'live'); assert.equal(status.json().nativeVoice.ready, true);
  for (const value of ['private-chat-fixture', 'private-audio-fixture', env.CHAT_BASE_URL]) assert.ok(!status.body.includes(value));
});

test('legacy credentials file settings are ignored without reading external files', () => {
  const env = { AI_CREDENTIALS_FILE: '/missing/credentials.env' };
  assert.equal(initialConfig(env).mode, 'unconfigured');
  assert.equal(initialConfig({ ...env, CHAT_API_KEY: 'direct-key' }).text.apiKey, 'direct-key');
});

test('missing or whitespace credentials cannot activate AI or a demo fallback', () => {
  assert.equal(initialConfig({}).mode, 'unconfigured');
  assert.equal(initialConfig({ CHAT_API_KEY: '  ' }).mode, 'unconfigured');
  assert.equal(initialConfig({ DASHSCOPE_API_KEY: 'speech-only' }).mode, 'unconfigured');
});

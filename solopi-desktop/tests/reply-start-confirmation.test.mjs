import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createReplyStartConfirmation } = require('../electron/reply-start-confirmation');

function settings() {
  return { deviceId:'device', contactId:'friend-1', role:'helper', contextCount:4,
    textProvider:{baseUrl:'https://example.test/v1',model:'text-model',apiKey:'test-secret'},
    visionProvider:{baseUrl:'https://vision.test/v1',model:'vision-model',apiKey:'vision-secret'} };
}

test('confirmation shows data scope without credentials and consumes the exact frozen configuration', () => {
  const manager = createReplyStartConfirmation({makeId:() => 'confirmation'});
  const config = settings();
  const preview = manager.prepare(config);
  assert.deepEqual(preview, {token:'confirmation',deviceId:'device',contact:'受控测试联系人 (friend-1)',
    text:{address:'https://example.test/v1/chat/completions',model:'text-model'},
    vision:{address:'https://vision.test/v1/chat/completions',model:'vision-model'},contextCount:4});
  assert.ok(!JSON.stringify(preview).includes('secret'));
  config.textProvider.baseUrl = 'https://changed.test/v1';
  config.textProvider.apiKey = 'changed';
  config.role = 'changed';
  const accepted = manager.consume(preview.token);
  assert.equal(accepted.textProvider.baseUrl, 'https://example.test/v1');
  assert.equal(accepted.textProvider.apiKey, 'test-secret');
  assert.equal(accepted.role, 'helper');
  assert.throws(() => manager.consume(preview.token), /reply_confirmation_expired/);
});

test('confirmation expires, cancels and replaces older preparations', () => {
  let time = 0, id = 0;
  const manager = createReplyStartConfirmation({clock:() => time, makeId:() => String(++id), ttlMs:100});
  const first = manager.prepare(settings());
  const second = manager.prepare(settings());
  assert.throws(() => manager.consume(first.token), /reply_confirmation_expired/);
  assert.throws(() => manager.consume(second.token), /reply_confirmation_expired/);
  const third = manager.prepare(settings());
  manager.cancel(third.token);
  assert.throws(() => manager.consume(third.token), /reply_confirmation_expired/);
  const fourth = manager.prepare(settings());
  time = 100;
  assert.throws(() => manager.consume(fourth.token), /reply_confirmation_expired/);
});

test('addresses containing URL credentials or query parameters cannot be previewed', () => {
  for (const address of ['https://user:secret@example.test/v1', 'https://example.test/v1?key=secret',
    'https://example.test/v1#secret', 'file:///tmp/model', 'not-a-url']) {
    const manager = createReplyStartConfirmation({makeId:() => 'confirmation'});
    const config = settings(); config.textProvider.baseUrl = address;
    assert.throws(() => manager.prepare(config), /reply_model_address_invalid/);
    assert.throws(() => manager.consume('confirmation'), /reply_confirmation_expired/);
  }
});

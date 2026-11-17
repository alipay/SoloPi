import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requestModel } = require('../electron/agent/model');
const diagnostics = require('../electron/diagnostics');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('reply requests never follow redirects or expose the redirect response', async (t) => {
  let targetRequests = 0;
  const target = await listen((request, response) => {
    targetRequests += 1;
    request.resume();
    request.on('end', () => {
      response.writeHead(200, {'content-type':'application/json'});
      response.end(JSON.stringify({choices:[{message:{content:'synthetic reply'},finish_reason:'stop'}]}));
    });
  });
  t.after(() => { target.closeAllConnections(); target.close(); });
  let status = 307;
  const source = await listen((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(status, {location:`http://127.0.0.1:${target.address().port}/target_fragment`});
      response.end('private_fragment');
    });
  });
  t.after(() => { source.closeAllConnections(); source.close(); });
  const provider = {baseUrl:`http://127.0.0.1:${source.address().port}/v1`,model:'synthetic-model'};
  const options = {provider,messages:[{role:'user',content:'synthetic message'}],tools:[],stream:false,retry:false};
  const original = diagnostics.record;
  const events = [];
  diagnostics.record = value => events.push(value);
  try {
    for (const purpose of ['reply-text','reply-image']) {
      for (const redirectStatus of [301,302,303,307,308]) {
        status = redirectStatus;
        await assert.rejects(requestModel({...options,purpose}), error => {
          assert.equal(error.diagnostics.category, 'redirect-blocked');
          assert.equal(error.diagnostics.httpStatus, redirectStatus);
          assert.doesNotMatch(JSON.stringify(error.diagnostics) + error.message, /private_fragment|target_fragment/);
          return true;
        });
      }
    }
    assert.equal(targetRequests, 0);
    assert.doesNotMatch(JSON.stringify(events), /private_fragment|target_fragment/);
    status = 307;
    assert.equal((await requestModel({...options,purpose:'conversation'})).content, 'synthetic reply');
    assert.equal(targetRequests, 1);
  } finally {
    diagnostics.record = original;
  }
});

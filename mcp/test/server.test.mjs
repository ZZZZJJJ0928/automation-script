import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Session } from '@violentmonkey/mcp';
import WebSocket from 'ws';
import { executionTools, startServer } from '../server.mjs';

test('MCP discovery and real HTTP/WebSocket transport preserve structured call results', async t => {
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const token = 'integration-test-token';
  const service = await startServer({ port, token, transport: 'http' });
  t.after(() => service.close());
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'chrome-extension://integration-test' });
  t.after(() => ws.close());
  await once(ws, 'open');
  const ready = once(ws, 'message');
  ws.send(JSON.stringify({
    type: 'hello', protocol: 1, token, client: { name: 'test', version: '1' }, tools: Object.keys(executionTools),
  }));
  assert.deepEqual(JSON.parse((await ready)[0]).tools.sort(), Object.keys(executionTools).sort());
  const received = [];
  const file = {
    fileId: 'file-1', downloadId: 42, scriptId: 1, frameId: 0, name: 'report.pdf',
    path: '/Downloads/automation-script/report.pdf', requestedPath: 'automation-script/report.pdf',
    size: 3, mimeType: 'application/pdf', status: 'completed', savedAt: Date.now(),
  };
  const result = {
    callId: 'call-1', scriptId: 1, frameId: 0, documentId: 'doc-1',
    seq: 2, status: 'completed', startedAt: Date.now(), value: { rows: [0, false, null, ''], file },
  };
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.type !== 'call') return;
    received.push(msg);
    const data = msg.tool === 'file_storage' ? { directory: '邮件归档/2026', downloadDirectory: '/Downloads' }
      : msg.tool === 'script_call' ? { result }
      : msg.tool === 'script_handlers' ? { handlers: [{ scriptId: 1, frameId: 0 }] }
        : msg.tool === 'script_files' ? { files: [file] }
        : { entries: [result], nextSeq: 2, dropped: 0 };
    ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, data }));
  });
  const client = new Client({ name: 'test-agent', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  const listing = await client.listTools();
  for (const name of Object.keys(executionTools)) assert.ok(listing.tools.some(tool => tool.name === name));
  const response = await client.callTool({ name: 'script_call', arguments: {
    tabId: 7, scriptId: 1, callId: 'call-1', params: { a: 2 },
  } });
  assert.deepEqual(response.structuredContent, { result });
  assert.deepEqual(received[0].params, {
    tabId: 7, scriptId: 1, frameId: 0, callId: 'call-1', params: { a: 2 }, wait: true, timeoutMs: 10000,
  });
  const read = await client.callTool({ name: 'script_results', arguments: { tabId: 7, callId: 'call-1' } });
  assert.deepEqual(read.structuredContent.entries, [result]);
  const files = await client.callTool({ name: 'script_files', arguments: { tabId: 7, fileId: 'file-1' } });
  assert.deepEqual(files.structuredContent, { files: [file] });
  assert.deepEqual(received.at(-1).params, { tabId: 7, fileId: 'file-1', limit: 50 });
  const config = await client.callTool({ name: 'file_storage', arguments: {} });
  assert.deepEqual(config.structuredContent, { directory: '邮件归档/2026', downloadDirectory: '/Downloads' });
  const invalid = await client.callTool({ name: 'script_call', arguments: { tabId: 7, scriptId: 1, timeoutMs: 99999 } });
  assert.equal(invalid.isError, true);
});

test('read-only mode denies script execution while permitting result reads', () => {
  const session = new Session({ token: 'test', server: { name: 'test', version: '1' }, readonly: true });
  assert.equal(session.isAllowed('script_call'), false);
  assert.equal(session.isAllowed('script_results'), true);
  assert.equal(session.isAllowed('script_handlers'), true);
  assert.equal(session.isAllowed('script_files'), true);
  assert.equal(session.isAllowed('file_storage'), true);
});

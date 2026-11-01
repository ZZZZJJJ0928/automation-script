import * as bridge from '@/injected/content/bridge';
import { setMcpToken } from '@/injected/content/mcp';
import { sendCmd } from '@/injected/content/util';

jest.mock('@/injected/content/bridge', () => ({
  addHandlers: jest.fn(),
  addBackgroundHandlers: jest.fn(),
  ids: {},
  post: jest.fn(),
}));
jest.mock('@/injected/content/util', () => ({ sendCmd: jest.fn() }));

const handlers = bridge.addHandlers.mock.calls[0][0];
const onCall = bridge.addBackgroundHandlers.mock.calls[0][0].McpCall;

beforeEach(() => {
  bridge.post.mockClear();
  sendCmd.mockReset().mockResolvedValue(true);
  bridge.ids[1] = PAGE;
  bridge.ids[2] = CONTENT;
  setMcpToken(Promise.resolve({ mcpToken: 'document-one' }));
});

test('registration waits for host response even with early cached injection', async () => {
  let resolve;
  setMcpToken(new Promise(ok => { resolve = ok; }));
  const registering = handlers.RegisterMcpHandler({ id: 1 }, PAGE);
  expect(sendCmd).not.toHaveBeenCalled();
  resolve({ mcpToken: 'fast-path-token' });
  await registering;
  expect(sendCmd).toHaveBeenCalledWith('RegisterMcpHandler', { id: 1, token: 'fast-path-token' });
});

test('routes calls to the correct realm without exposing the document token', async () => {
  await handlers.RegisterMcpHandler({ id: 2 }, CONTENT);
  expect(onCall({ id: 2, callId: 'call', token: 'document-one', params: [1] })).toBe(true);
  expect(bridge.post).toHaveBeenCalledWith('McpCall', { id: 2, callId: 'call', params: [1] }, CONTENT);
  expect(onCall({ id: 2, callId: 'call', token: 'stale' })).toBe(false);
});

test('rejects ungranted documents and mismatched script realms', async () => {
  await expect(handlers.ScriptResult({ id: 1, json: '0' }, CONTENT)).rejects.toThrow(/unavailable/);
  setMcpToken(Promise.resolve({}));
  await expect(handlers.RegisterMcpHandler({ id: 1 }, PAGE)).rejects.toThrow(/unavailable/);
  expect(sendCmd).not.toHaveBeenCalled();
});

test('file bridge encodes binary bytes without sending raw blobs through JSON messaging', async () => {
  const file = { fileId: 'one', size: 3 };
  sendCmd.mockResolvedValue(file);
  const data = new Blob([new Uint8Array([0, 128, 255])], { type: 'application/pdf' });
  expect(await handlers.McpSaveFile({ id: 1, data, name: 'report.pdf' }, PAGE)).toBe(file);
  expect(sendCmd).toHaveBeenCalledWith('McpSaveFile', {
    id: 1, name: 'report.pdf', directory: undefined,
    dataUrl: 'data:application/pdf;base64,AID/', token: 'document-one',
  });
});

test('file bridge rejects unauthorized requests before reading their data', async () => {
  const data = { id: 1, data: new Blob(['private']), name: 'report.txt' };
  await expect(handlers.McpSaveFile(data, CONTENT)).rejects.toThrow(/unavailable/);
  setMcpToken(Promise.resolve({}));
  await expect(handlers.McpSaveFile(data, PAGE)).rejects.toThrow(/unavailable/);
  expect(sendCmd).not.toHaveBeenCalled();
});

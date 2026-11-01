import { createClient } from '@violentmonkey/mcp-client';
import browser from '@/common/browser';
import { commands } from '@/background/utils/init';
import { requestMcpConnection } from '@/background/utils/mcp';
import { startDocument } from '@/background/utils/mcp-execution';

jest.mock('@violentmonkey/mcp-client', () => ({
  createClient: jest.fn(),
  ErrorCode: { Denied: 403, NotFound: 404, InvalidParams: 400, Internal: 500 },
  ToolCallError: class extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}), { virtual: true }); // upstream only exposes an ESM import condition
jest.mock('@/background/utils/init', () => {
  const handlers = {};
  return {
    commands: handlers,
    addOwnCommands: obj => Object.assign(handlers, obj),
    addPublicCommands: obj => Object.assign(handlers, obj),
  };
});
jest.mock('@/background/utils/db', () => ({
  getScriptById: id => ({ props: { id }, config: { enabled: 1 } }),
}));
jest.mock('@/background/utils/tabs', () => ({
  tabsOnRemoved: { addListener: jest.fn() },
  getTabUrl: tab => tab.url,
}));
jest.mock('@/background/utils/script', () => ({}));
jest.mock('@/background/utils/storage', () => ({}));
jest.mock('@/background/utils/tester', () => ({}));

let tools;
let token;
const sender = { tab: { id: 7 }, frameId: 0 };

beforeEach(() => {
  tools = {};
  let onStatus;
  createClient.mockReturnValue({
    handle: (name, fn) => { tools[name] = fn; },
    on: (event, fn) => { onStatus = fn; },
    connect: () => onStatus('open'),
    close: () => onStatus('closed'),
  });
  browser.tabs.get = jest.fn(async id => ({ id, url: 'https://example.com/' }));
  browser.tabs.sendMessage = jest.fn(async (tabId, { data }) => {
    commands.ScriptResult({ id: data.id, callId: data.callId, token: data.token, json: JSON.stringify(data.params) }, sender);
    return true;
  });
  requestMcpConnection('https://example.com/?port=5678&token=test');
  commands.McpApprove();
  commands.McpGrantTab(7);
  token = startDocument(7, 0);
  commands.RegisterMcpHandler({ id: 1, token }, sender);
});
afterEach(() => commands.McpDisconnect());

test('tool call dispatches to the target frame and returns the matching structured result', async () => {
  const { result } = await tools.script_call({ tabId: 7, scriptId: 1, params: { rows: [0, false] } });
  expect(result).toMatchObject({ status: 'completed', scriptId: 1, value: { rows: [0, false] } });
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(7, {
    cmd: 'McpCall', data: { id: 1, callId: result.callId, params: { rows: [0, false] }, token },
  }, { frameId: 0 });
  expect(await tools.script_results({ tabId: 7, callId: result.callId }))
  .toMatchObject({ entries: [result] });
  expect(await tools.script_handlers({ tabId: 7 })).toEqual({ handlers: [{ scriptId: 1, frameId: 0 }] });
});

test('wait=false returns immediately and repeated IDs do not dispatch again', async () => {
  browser.tabs.sendMessage.mockResolvedValue(true);
  const args = { tabId: 7, scriptId: 1, callId: 'queued', wait: false };
  expect((await tools.script_call(args)).result.status).toBe('pending');
  expect((await tools.script_call(args)).result.status).toBe('pending');
  expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
  commands.ScriptResult({ id: 1, token, callId: 'queued', json: 'false' }, sender);
  expect((await tools.script_call({ ...args, wait: true })).result.value).toBe(false);
});

test('authorization gates calls and reads, and revocation clears results', async () => {
  await expect(tools.script_call({ tabId: 8, scriptId: 1 })).rejects.toMatchObject({ code: 403 });
  await tools.script_call({ tabId: 7, scriptId: 1 });
  commands.McpRevokeTab(7);
  await expect(tools.script_results({ tabId: 7 })).rejects.toMatchObject({ code: 403 });
  expect(() => commands.ScriptResult({ id: 1, token, json: '1' }, sender)).toThrow(/not authorized/);
  commands.McpGrantTab(7);
  expect((await tools.script_results({ tabId: 7 })).entries).toEqual([]);
});

test('delivery failures complete the call instead of hanging', async () => {
  browser.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
  const { result } = await tools.script_call({ tabId: 7, scriptId: 1 });
  expect(result).toMatchObject({ status: 'failed', error: 'Receiving end does not exist' });
});

test('script call can save a file and return metadata queryable through MCP', async () => {
  browser.downloads = {
    download: jest.fn(async () => 42),
    search: jest.fn(async () => [{
      id: 42, state: 'complete', filename: '/Downloads/automation-script/report.txt', fileSize: 5,
    }]),
    cancel: jest.fn(async () => {}),
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    onErased: { addListener: jest.fn(), removeListener: jest.fn() },
  };
  browser.tabs.sendMessage.mockImplementation(async (tabId, { data }) => {
    const file = await commands.McpSaveFile({
      id: data.id, token: data.token, name: 'report.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=',
    }, sender);
    commands.ScriptResult({ id: data.id, token: data.token, callId: data.callId, json: JSON.stringify(file) }, sender);
    return true;
  });
  const { result } = await tools.script_call({ tabId: 7, scriptId: 1 });
  expect(result).toMatchObject({
    status: 'completed', value: { fileId: expect.any(String), path: '/Downloads/automation-script/report.txt', size: 5 },
  });
  expect(await tools.script_files({ tabId: 7, fileId: result.value.fileId })).toEqual({ files: [result.value] });
  await expect(tools.script_files({ tabId: 8 })).rejects.toMatchObject({ code: 403 });
  expect(() => commands.McpSaveFile({ id: 1, token: 'stale' }, sender)).toThrow(/different document/);
  commands.McpRevokeTab(7);
  expect(() => commands.McpSaveFile({ id: 1, token }, sender)).toThrow(/not authorized/);
  commands.McpGrantTab(7);
  expect(await tools.script_files({ tabId: 7 })).toEqual({ files: [] });
});


test('file storage configuration is available without granting a tab and contains no script or file data', async () => {
  commands.McpRevokeTab(7);
  expect(await tools.file_storage({})).toEqual({ directory: 'automation-script', downloadDirectory: null });
});

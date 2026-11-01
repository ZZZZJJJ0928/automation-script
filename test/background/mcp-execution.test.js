import {
  beginCall, CALLS_MAX, clearExecution, dropExecutionTab, failCall, getHandlers,
  getResults, registerHandler, reportResult, startDocument,
} from '@/background/utils/mcp-execution';
import { MCP_RESULT_MAX } from '@/common/consts';

const TAB = 7;
let token;
beforeEach(() => {
  jest.useFakeTimers();
  token = startDocument(TAB, 0);
  registerHandler(TAB, 0, token, 1);
});
afterEach(() => {
  clearExecution();
  jest.useRealTimers();
});

function reply(call, value, extra = {}) {
  return reportResult(TAB, 0, token, {
    id: 1, callId: call.result.callId, json: JSON.stringify(value), ...extra,
  });
}

test('correlates concurrent results and preserves falsy/structured values', async () => {
  const calls = [false, 0, '', null, { count: 2, rows: [1, 2] }]
  .map(value => ({ value, call: beginCall(TAB, { scriptId: 1 }) }));
  for (const { value, call } of calls.reverse()) reply(call, value);
  for (const { value, call } of calls) {
    expect(await call.promise).toMatchObject({ status: 'completed', value, callId: call.result.callId });
  }
  expect(getResults(TAB).entries).toHaveLength(calls.length);
});

test('deduplicates retained call ids, rejects conflicting reuse and duplicate replies', async () => {
  const args = { scriptId: 1, callId: 'request-1', params: { a: 1 } };
  const call = beginCall(TAB, args);
  expect(beginCall(TAB, args).isNew).toBe(false);
  expect(() => beginCall(TAB, { ...args, params: 2 })).toThrow(/different call/);
  reply(call, 42);
  expect(reply(call, 43).accepted).toBe(false);
  expect(await beginCall(TAB, args).promise).toMatchObject({ value: 42 });
});

test('times out without pretending to stop the script and accepts late results', async () => {
  const call = beginCall(TAB, { scriptId: 1, callId: 'slow', timeoutMs: 20 });
  jest.advanceTimersByTime(20);
  const result = await call.promise;
  expect(result.status).toBe('timed_out');
  reply(call, 'late');
  expect(getResults(TAB, { afterSeq: result.seq }).entries[0])
  .toMatchObject({ status: 'completed', value: 'late' });
  expect(await beginCall(TAB, { scriptId: 1, callId: 'slow' }).promise)
  .toMatchObject({ status: 'completed', value: 'late' });
});

test('returns errors and delivery failures as structured results', async () => {
  const failed = beginCall(TAB, { scriptId: 1 });
  reply(failed, null, { error: 'Script rejected' });
  expect(await failed.promise).toMatchObject({ status: 'failed', error: 'Script rejected' });
  const missing = beginCall(TAB, { scriptId: 1 });
  failCall(TAB, missing.result.callId, 'No receiver');
  expect(await missing.promise).toMatchObject({ status: 'failed', error: 'No receiver' });
});

test('isolates tabs, scripts, frames and documents', () => {
  const call = beginCall(TAB, { scriptId: 1 });
  expect(() => reply(call, 1, { id: 2 })).toThrow(/matching call/);
  const sub = startDocument(TAB, 2);
  registerHandler(TAB, 2, sub, 1);
  expect(() => reportResult(TAB, 2, sub, { ...call.message, json: '1' })).toThrow(/matching call/);
  const other = startDocument(8, 0);
  expect(() => reportResult(8, 0, other, { ...call.message, json: '1' })).toThrow(/matching call/);
  expect(() => registerHandler(TAB, 0, 'stale-token', 1)).toThrow(/different document/);
  expect(getHandlers(TAB).handlers).toEqual([{ scriptId: 1, frameId: 0 }, { scriptId: 1, frameId: 2 }]);
});

test('navigation cancels waiters and rejects replies from the previous document', async () => {
  const call = beginCall(TAB, { scriptId: 1 });
  startDocument(TAB, 0);
  expect(await call.promise).toMatchObject({ status: 'cancelled' });
  expect(() => reply(call, 'stale')).toThrow(/different document/);
  expect(getHandlers(TAB).handlers).toEqual([]);
});

test('subframe reload only cancels that frame', async () => {
  const main = beginCall(TAB, { scriptId: 1 });
  registerHandler(TAB, 2, startDocument(TAB, 2), 1);
  const sub = beginCall(TAB, { scriptId: 1, frameId: 2 });
  startDocument(TAB, 2);
  expect(await sub.promise).toMatchObject({ status: 'cancelled' });
  reply(main, 'ok');
  expect(await main.promise).toMatchObject({ status: 'completed' });
});

test('revocation/tab close clears results, handlers and pending timers', async () => {
  const call = beginCall(TAB, { scriptId: 1 });
  dropExecutionTab(TAB);
  expect(await call.promise).toMatchObject({ status: 'cancelled' });
  expect(getResults(TAB).entries).toEqual([]);
  expect(getHandlers(TAB).handlers).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
  expect(() => reply(call, 1)).toThrow(/different document/);
});

test('stores unsolicited reports and supports non-destructive filtered pagination', () => {
  for (let i = 0; i < 3; i += 1) reportResult(TAB, 0, token, { id: 1, json: `${i}` });
  reportResult(TAB, 0, token, { id: 2, json: 'false' });
  const first = getResults(TAB, { scriptId: 1, limit: 2 });
  expect(first.entries.map(e => e.value)).toEqual([0, 1]);
  expect(getResults(TAB, { scriptId: 1, afterSeq: first.nextSeq }).entries.map(e => e.value)).toEqual([2]);
  expect(getResults(TAB, { callId: first.entries[0].callId }).entries).toEqual([first.entries[0]]);
});

test('caps results and expires old terminal entries', () => {
  for (let i = 0; i < CALLS_MAX + 2; i += 1) reportResult(TAB, 0, token, { id: 1, json: `${i}` });
  expect(getResults(TAB, { limit: CALLS_MAX }).entries).toHaveLength(CALLS_MAX);
  expect(getResults(TAB).dropped).toBe(2);
  jest.advanceTimersByTime(5 * 60 * 1000 + 1);
  expect(getResults(TAB).entries).toEqual([]);
});

test('rejects missing handlers, oversized results and invalid options', () => {
  expect(() => beginCall(TAB, { scriptId: 2 })).toThrow(/no MCP handler/);
  expect(() => beginCall(TAB, { scriptId: 1, timeoutMs: 30000 })).toThrow(/Invalid call/);
  expect(() => beginCall(TAB, { scriptId: 1, params: 'x'.repeat(MCP_RESULT_MAX) })).toThrow(/size limit/);
  expect(() => reportResult(TAB, 0, token, { id: 1, json: 'x'.repeat(MCP_RESULT_MAX + 1) })).toThrow(/Invalid script result/);
  expect(() => reportResult(TAB, 0, token, { id: 1, json: 'not-json' })).toThrow(/must be JSON/);
  expect(() => getResults(TAB, { limit: -1 })).toThrow(/Invalid results/);
});

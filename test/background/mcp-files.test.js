import browser from '@/common/browser';
import { getOption } from '@/background/utils/options';

jest.mock('@/background/utils/options', () => ({ getOption: jest.fn() }));
import { MCP_FILE_MAX } from '@/common/consts';
import { clearFiles, dropFileTab, FILE_SAVE_TIMEOUT, getFiles, getFileStorage, saveMcpFile } from '@/background/utils/mcp-files';

const data = { id: 1, name: 'report.pdf', directory: 'exports', dataUrl: 'data:application/pdf;base64,AID/' };
const authorize = jest.fn();
let changed;
let erased;
let records;
let stored;

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  getOption.mockReturnValue('automation-script');
  stored = {};
  browser.storage.local.get = jest.fn(async () => stored);
  browser.storage.local.set = jest.fn(async value => { Object.assign(stored, value); });
  authorize.mockReset();
  changed = new Set();
  erased = new Set();
  records = new Map();
  const event = listeners => ({
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
  });
  browser.downloads = {
    download: jest.fn(async () => {
      const id = records.size + 1;
      records.set(id, { id, state: 'in_progress' });
      return id;
    }),
    search: jest.fn(async ({ id }) => records.has(id) ? [records.get(id)] : []),
    cancel: jest.fn(async () => {}),
    onChanged: event(changed),
    onErased: event(erased),
  };
});
afterEach(() => {
  clearFiles();
  expect(changed.size).toBe(0);
  expect(erased.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

function complete(id, extra = {}) {
  records.set(id, {
    id, state: 'complete', filename: `/Downloads/automation-script/exports/report (${id}).pdf`,
    fileSize: 3, exists: true, ...extra,
  });
  changed.forEach(fn => fn({ id, state: { current: 'complete' } }));
}

test('missing optional downloads permission fails clearly without allocating a transfer', () => {
  const api = browser.downloads;
  delete browser.downloads;
  expect(() => saveMcpFile(7, 0, data, authorize)).toThrow(/enable "Use browser download API"/);
  expect(jest.getTimerCount()).toBe(0);
  expect(changed.size).toBe(0);
  browser.downloads = api;
});

test('waits for disk completion and returns the actual renamed path and size', async () => {
  let resolved = false;
  const promise = saveMcpFile(7, 0, data, authorize).then(file => { resolved = true; return file; });
  await flush();
  expect(resolved).toBe(false);
  expect(getFiles(7)).toEqual({ files: [] });
  expect(browser.downloads.download).toHaveBeenCalledWith({
    url: data.dataUrl, filename: 'automation-script/exports/report.pdf', conflictAction: 'uniquify', saveAs: false,
  });
  complete(1);
  const file = await promise;
  expect(file).toMatchObject({
    fileId: expect.any(String), downloadId: 1, scriptId: 1, frameId: 0,
    name: 'report (1).pdf', path: '/Downloads/automation-script/exports/report (1).pdf',
    requestedPath: 'automation-script/exports/report.pdf', size: 3, mimeType: 'application/pdf', status: 'completed',
  });
  expect(getFiles(8).files).toEqual([]);
  expect(getFiles(7, { scriptId: 2 }).files).toEqual([]);
  expect(getFiles(7, { fileId: file.fileId }).files).toEqual([file]);
  file.path = 'mutated';
  expect(getFiles(7).files[0].path).not.toBe('mutated');
});

test('handles completion before download() returns its id, and empty files', async () => {
  browser.downloads.download.mockImplementation(async () => {
    complete(1, { fileSize: 0 });
    return 1;
  });
  expect(await saveMcpFile(7, 0, { ...data, dataUrl: 'data:application/pdf;base64,' }, authorize))
  .toMatchObject({ size: 0, status: 'completed' });
});

test.each([
  { name: '../secret' }, { name: '/tmp/file' }, { name: 'a\\b' }, { name: '..' },
  { name: 'CON.txt' }, { name: 'file\u0000.txt' }, { name: 'file.' },
  { directory: '../' }, { directory: '/tmp' }, { directory: 'a//b' }, { directory: 'C:\\tmp' },
  { dataUrl: 'https://example.com/file' }, { dataUrl: 'data:text/plain;base64,????' },
  { dataUrl: 'data:text/plain;base64,a===' }, { dataUrl: 'data:text/plain;base64,a' },
  { dataUrl: `data:application/pdf;base64,${'A'.repeat(Math.ceil((MCP_FILE_MAX + 1) / 3) * 4)}` },
])('rejects unsafe paths or invalid payloads: %p', overrides => {
  expect(() => saveMcpFile(7, 0, { ...data, ...overrides }, authorize)).toThrow();
  expect(browser.downloads.download).not.toHaveBeenCalled();
});

test.each(['start', 'interrupted', 'erased', 'query', 'size'])('rejects %s failures without reporting success', async failure => {
  if (failure === 'start') browser.downloads.download.mockRejectedValue(new Error('Disk full'));
  const promise = saveMcpFile(7, 0, data, authorize);
  const failed = expect(promise).rejects.toThrow();
  await flush();
  if (failure === 'interrupted') changed.forEach(fn => fn({ id: 1, error: { current: 'USER_CANCELED' } }));
  if (failure === 'erased') erased.forEach(fn => fn(1));
  if (failure === 'query') browser.downloads.search.mockRejectedValueOnce(new Error('Unavailable'));
  if (failure === 'query' || failure === 'size') complete(1, { fileSize: 99 });
  await failed;
  expect(getFiles(7).files).toEqual([]);
});

test('cancels a download if authorization ends while its id is still pending', async () => {
  let started;
  browser.downloads.download.mockReturnValue(new Promise(resolve => { started = resolve; }));
  const promise = saveMcpFile(7, 0, data, authorize);
  const failed = expect(promise).rejects.toThrow(/authorization ended/);
  await flush();
  dropFileTab(7);
  await failed;
  started(42);
  await flush();
  expect(browser.downloads.cancel).toHaveBeenCalledWith(42);
  expect(getFiles(7).files).toEqual([]);
});

test('rechecks document authorization before returning a saved file', async () => {
  const promise = saveMcpFile(7, 0, data, authorize);
  const failed = expect(promise).rejects.toThrow(/navigated/);
  await flush();
  authorize.mockImplementation(() => { throw new Error('Document navigated'); });
  complete(1);
  await failed;
  expect(getFiles(7).files).toEqual([]);
});

test('bounds concurrent transfers and times out stalled downloads', async () => {
  const promises = Array.from({ length: 4 }, () => saveMcpFile(7, 0, data, authorize));
  const failures = promises.map(promise => expect(promise).rejects.toThrow(/timed out/));
  expect(() => saveMcpFile(7, 0, data, authorize)).toThrow(/Too many/);
  await flush();
  jest.advanceTimersByTime(FILE_SAVE_TIMEOUT);
  await Promise.all(failures);
  await flush();
  expect(browser.downloads.cancel).toHaveBeenCalledTimes(4);
});

test('expires metadata while leaving completed files on disk', async () => {
  const promise = saveMcpFile(7, 0, data, authorize);
  await flush();
  complete(1);
  await promise;
  jest.advanceTimersByTime(5 * 60 * 1000 + 1);
  expect(getFiles(7).files).toEqual([]);
  expect(browser.downloads.cancel).not.toHaveBeenCalled();
});


test('uses the configured directory for new saves and keeps in-progress saves at their original destination', async () => {
  getOption.mockReturnValue('邮件归档/2026');
  const first = saveMcpFile(7, 0, data, authorize);
  getOption.mockReturnValue('another-folder');
  await flush();
  expect(browser.downloads.download.mock.calls[0][0].filename).toBe('邮件归档/2026/exports/report.pdf');
  complete(1, { filename: '/Downloads/邮件归档/2026/exports/report.pdf' });
  expect(await first).toMatchObject({ requestedPath: '邮件归档/2026/exports/report.pdf', path: '/Downloads/邮件归档/2026/exports/report.pdf', size: 3 });
  const second = saveMcpFile(7, 0, data, authorize);
  await flush();
  expect(browser.downloads.download.mock.calls[1][0].filename).toBe('another-folder/exports/report.pdf');
  complete(2); await second;
});
test('empty configured directory saves relative to the browser download location', async () => {
  getOption.mockReturnValue('');
  const promise = saveMcpFile(7, 0, { ...data, directory: '' }, authorize);
  await flush();
  expect(browser.downloads.download.mock.calls[0][0].filename).toBe('report.pdf');
  complete(1); await promise;
});
test.each(['/tmp/files', '../files', 'a//b', 'a/../b', 'C:\\files', 'CON', null])('rejects invalid configured directories before starting a save: %p', root => {
  getOption.mockReturnValue(root);
  expect(() => saveMcpFile(7, 0, data, authorize)).toThrow();
  expect(browser.downloads.download).not.toHaveBeenCalled();
});


test('file storage settings retain the confirmed browser root across result cache resets', async () => {
  expect(await getFileStorage()).toEqual({ directory: 'automation-script', downloadDirectory: null });
  const promise = saveMcpFile(7, 0, data, authorize);
  await flush(); complete(1, { filename: '/custom-downloads/automation-script/exports/report (1).pdf' }); await promise;
  clearFiles();
  getOption.mockReturnValue('邮件归档/2026');
  expect(await getFileStorage()).toEqual({ directory: '邮件归档/2026', downloadDirectory: '/custom-downloads' });
});
test('manual destinations with unrelated parent folders do not overwrite the inferred download root', async () => {
  const promise = saveMcpFile(7, 0, data, authorize);
  await flush(); complete(1, { filename: '/manual/location/report.pdf' }); await promise;
  expect(await getFileStorage()).toEqual({ directory: 'automation-script', downloadDirectory: null });
});

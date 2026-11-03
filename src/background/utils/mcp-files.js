import browser from '@/common/browser';
import { keepAlive } from '@/common';
import { MCP_FILE_MAX } from '@/common/consts';
import { validateFileDirectory, validateFileName } from '@/common/file-path';
import { kMcpFileDirectory } from '@/common/options-defaults';
import { getOption } from './options';

export const FILE_SAVE_TIMEOUT = 120000;
const FILES_MAX = 100;
const PENDING_MAX = 4;
const TTL = 5 * 60 * 1000;
const LOCATION_KEY = 'mcpFileDownloadLocation';
const pending = new Map();
const files = new Map();

function invalid(message) {
  throw Object.assign(new Error(message), { code: 400 });
}

function validate({ name, directory = '', dataUrl }) {
  const root = validateFileDirectory(getOption(kMcpFileDirectory));
  const filename = [root, validateFileDirectory(directory), validateFileName(name)].filter(Boolean).join('/');
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MCP_FILE_MAX / 3) * 4 + 280) {
    invalid('File exceeds 16 MB or has invalid data');
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || comma > 275 || !/^data:[\x20-\x7e]*;base64$/.test(dataUrl.slice(0, comma))) {
    invalid('File data must be a base64 data URL');
  }
  const base64 = dataUrl.slice(comma + 1);
  if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) invalid('Invalid base64 file data');
  const size = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (size > MCP_FILE_MAX) invalid('File exceeds 16 MB');
  return { filename, size, mimeType: dataUrl.slice(5, comma - 7) || 'application/octet-stream' };
}

function prune(tabId) {
  const entries = files.get(tabId);
  if (!entries) return;
  for (const [id, file] of entries) {
    if (Date.now() - file.savedAt > TTL || entries.size > FILES_MAX) entries.delete(id);
  }
  if (!entries.size) files.delete(tabId);
}

/** Configuration only: no tab contents, file contents or tokens are exposed. */
export async function getFileStorage() {
  const stored = (await browser.storage.local.get(LOCATION_KEY))[LOCATION_KEY];
  return {
    directory: validateFileDirectory(getOption(kMcpFileDirectory)),
    downloadDirectory: typeof stored?.directory === 'string' ? stored.directory : null,
  };
}

function rememberDownloadLocation(file) {
  const actual = file.path.replace(/\\/g, '/');
  const parent = actual.slice(0, actual.lastIndexOf('/'));
  const suffix = file.requestedPath.split('/').slice(0, -1).join('/');
  // A save-as override may not preserve the requested subdirectories. Do not
  // infer the browser's download root from an unrelated manual destination.
  if (suffix && !parent.endsWith(`/${suffix}`)) return;
  let directory = (suffix ? parent.slice(0, -suffix.length - 1) : parent) || '/';
  if (/^[A-Za-z]:$/.test(directory)) directory += '/';
  // Persist independently of the five-minute result cache and tab grants.
  browser.storage.local.set({ [LOCATION_KEY]: { directory } }).catch(() => {});
}

/** Resolves only after downloads.search confirms the final on-disk filename. */
export function saveMcpFile(tabId, frameId, data, authorize) {
  authorize();
  // downloads is optional and is absent entirely in Chrome until permission is granted.
  // Check before allocating a transfer so missing permissions cannot leak its timer.
  const downloads = browser.downloads;
  if (!downloads?.download || !downloads.onChanged || !downloads.onErased) {
    throw new Error('File saving requires the downloads permission; enable "Use browser download API" in extension settings');
  }
  const { filename, size, mimeType } = validate(data);
  if (pending.size >= PENDING_MAX) invalid('Too many pending file saves (maximum 4)');
  const fileId = crypto.randomUUID();
  const saving = new Promise((resolve, reject) => {
    let downloadId;
    let done = false;
    const cancelDownload = () => {
      if (downloadId != null) {
        Promise.resolve().then(() => downloads.cancel(downloadId)).catch(() => {});
      }
    };
    const finish = (error, info) => {
      if (done) return;
      if (!error) {
        try {
          authorize();
          if (!info.filename || info.exists === false) throw new Error('Saved file is unavailable');
          if (info.fileSize >= 0 && info.fileSize !== size) throw new Error('Saved file size does not match submitted data');
        } catch (e) { error = e; }
      }
      done = true;
      clearTimeout(timer);
      downloads.onChanged.removeListener(onChanged);
      downloads.onErased.removeListener(onErased);
      pending.delete(fileId);
      if (error) {
        cancelDownload();
        reject(error);
        return;
      }
      const file = {
        fileId, downloadId, scriptId: data.id, frameId,
        name: info.filename.split(/[\\/]/).at(-1),
        path: info.filename, requestedPath: filename, size, mimeType,
        status: 'completed', savedAt: Date.now(),
      };
      let entries = files.get(tabId);
      if (!entries) files.set(tabId, entries = new Map());
      entries.set(fileId, file);
      rememberDownloadLocation(file);
      prune(tabId);
      resolve({ ...file });
    };
    const query = async () => {
      try {
        const [info] = await downloads.search({ id: downloadId });
        if (done) return;
        if (!info) finish(new Error('Download record is no longer available'));
        else if (info.state === 'complete') finish(null, info);
        else if (info.state === 'interrupted') finish(new Error(info.error || 'File save interrupted'));
      } catch (error) { finish(error); }
    };
    const onChanged = delta => {
      if (downloadId == null || delta.id !== downloadId || done) return;
      if (delta.error?.current) finish(new Error(delta.error.current));
      else if (delta.state) query();
    };
    const onErased = id => {
      if (id === downloadId) finish(new Error('Download record was erased'));
    };
    const timer = setTimeout(() => finish(new Error('File save timed out after 120 seconds')), FILE_SAVE_TIMEOUT);
    pending.set(fileId, { tabId, cancel: () => finish(new Error('File save cancelled: MCP authorization ended')) });
    downloads.onChanged.addListener(onChanged);
    downloads.onErased.addListener(onErased);
    // A fast download can finish before download() resolves; query after getting its id.
    Promise.resolve().then(() => {
      if (done) return undefined;
      authorize();
      return downloads.download({
        url: data.dataUrl, filename, conflictAction: 'uniquify', saveAs: false,
      });
    }).then(id => {
      downloadId = id;
      if (done) cancelDownload();
      else if (!Number.isInteger(id) || id < 0) finish(new Error('Browser did not return a download ID'));
      else query();
    }, error => finish(error));
  });
  // The download may take longer than an idle MV3 service worker lives.
  if (__.MV3) keepAlive(saving);
  return saving;
}

export function getFiles(tabId, { scriptId, fileId, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > FILES_MAX
    || scriptId != null && (!Number.isSafeInteger(scriptId) || scriptId <= 0)
    || fileId != null && (typeof fileId !== 'string' || !fileId || fileId.length > 128)) {
    invalid('Invalid file query');
  }
  prune(tabId);
  return {
    files: [...(files.get(tabId)?.values() || [])]
    .filter(file => (scriptId == null || file.scriptId === scriptId) && (fileId == null || file.fileId === fileId))
    .slice(-limit).map(file => ({ ...file })),
  };
}

export function dropFileTab(tabId) {
  for (const entry of pending.values()) if (entry.tabId === tabId) entry.cancel();
  files.delete(tabId);
}

export function clearFiles() {
  for (const entry of pending.values()) entry.cancel();
  files.clear();
}

import { startServer as startUpstreamServer } from '@violentmonkey/mcp';
import { tools, toolNames } from '@violentmonkey/mcp-protocol/schemas';
import { z } from 'zod';

const tabId = z.number().int().nonnegative();
const scriptId = z.number().int().positive();
const frameId = z.number().int().nonnegative();
const callId = z.string().min(1).max(128);
const execution = z.object({
  callId,
  scriptId,
  frameId,
  documentId: z.string(),
  seq: z.number().int().nonnegative(),
  status: z.enum(['pending', 'completed', 'failed', 'timed_out', 'cancelled']),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  value: z.json().optional(),
  error: z.string().optional(),
});
const savedFile = z.object({
  fileId: z.string(),
  downloadId: z.number().int().nonnegative(),
  scriptId,
  frameId,
  name: z.string(),
  path: z.string(),
  requestedPath: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  status: z.literal('completed'),
  savedAt: z.number(),
});

// Upstream 0.1.2 exports a shared, mutable schema registry. Extend it before
// creating a server so discovery, handshake filtering and validation all agree.
// Exact dependency pins and the transport integration test guard this adapter.
export const executionTools = {
  file_storage: {
    title: 'Read file storage configuration',
    description: 'Read the configured relative GM_saveFile directory and the browser download root inferred from its most recent completed save (null until known). Local consumers can follow directory changes without reading tab or file contents. Does not change settings.',
    input: z.object({}),
    output: z.object({ directory: z.string(), downloadDirectory: z.string().nullable() }),
    annotations: { readOnlyHint: true },
  },
  script_files: {
    title: 'Read saved script files',
    description: 'List completed GM_saveFile saves in a granted tab. Returns fileId, actual absolute path on the browser machine, byte size and MIME type. Files are saved under the browser download location using the file save directory configured in extension settings (default: automation-script), followed by the script-supplied directory. Metadata is retained in memory for 5 minutes, up to 100 files per tab; disconnect/revocation clears metadata, not saved files. Does not read file contents.',
    input: z.object({
      tabId,
      scriptId: scriptId.optional(),
      fileId: z.string().min(1).max(128).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    output: z.object({ files: z.array(savedFile) }),
    annotations: { readOnlyHint: true },
  },
  script_handlers: {
    title: 'List callable script handlers',
    description: 'List scripts that registered GM_registerMcpHandler in a granted tab. Grant and reload the tab first.',
    input: z.object({ tabId }),
    output: z.object({ handlers: z.array(z.object({ scriptId, frameId })) }),
    annotations: { readOnlyHint: true },
  },
  script_call: {
    title: 'Call a userscript',
    description: 'Invoke the registered handler with JSON params. Returns its value, error, or timeout. wait=false returns a callId immediately; query script_results afterwards. A timeout does not stop script side effects. Reusing a retained callId with identical params does not execute again.',
    input: z.object({
      tabId, scriptId,
      frameId: frameId.default(0),
      params: z.json().default(null),
      callId: callId.optional(),
      wait: z.boolean().default(true),
      timeoutMs: z.number().int().min(1).max(25000).default(10000),
    }),
    output: z.object({ result: execution }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  script_results: {
    title: 'Read script results',
    description: 'Read retained structured results, including GM_reportResult reports. Filter by callId or scriptId; use afterSeq for updates. Results are kept in memory for up to 5 minutes with entry/size caps; dropped is cumulative. Authorization revocation, tab close or disconnect clears them.',
    input: z.object({
      tabId,
      scriptId: scriptId.optional(),
      callId: callId.optional(),
      afterSeq: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    output: z.object({ entries: z.array(execution), nextSeq: z.number(), dropped: z.number() }),
    annotations: { readOnlyHint: true },
  },
};

for (const [name, definition] of Object.entries(executionTools)) {
  tools[name] = definition;
  if (!toolNames.includes(name)) toolNames.push(name);
}

export function startServer(options) {
  return startUpstreamServer({ ...options, callTimeoutMs: Math.max(30000, options.callTimeoutMs || 0) });
}

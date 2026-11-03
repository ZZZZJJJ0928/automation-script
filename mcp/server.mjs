import { startServer as startUpstreamServer } from '@violentmonkey/mcp';
import { tools, toolNames } from '@violentmonkey/mcp-protocol/schemas';
import { z } from 'zod';

const tabId = z.number().int().nonnegative();
const scriptId = z.number().int().positive();
const savedFile = z.object({
  fileId: z.string(),
  downloadId: z.number().int().nonnegative(),
  scriptId,
  frameId: z.number().int().nonnegative(),
  name: z.string(),
  path: z.string(),
  requestedPath: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  status: z.literal('completed'),
  savedAt: z.number(),
});

// script_handlers, script_call and script_results come from upstream 0.2.0.
// It exports a shared, mutable schema registry: extend it before creating a server
// so discovery, handshake filtering and validation all agree. The exact dependency
// pins and the transport integration test guard this adapter.
export const fileTools = {
  file_storage: {
    title: 'Read file storage configuration',
    description: 'Read the configured relative GM.mcp.saveFile directory and the browser download root inferred from its most recent completed save (null until known). Local consumers can follow directory changes without reading tab or file contents. Does not change settings.',
    input: z.object({}),
    output: z.object({ directory: z.string(), downloadDirectory: z.string().nullable() }),
    annotations: { readOnlyHint: true },
  },
  script_files: {
    title: 'Read saved script files',
    description: 'List completed GM.mcp.saveFile saves in a granted tab. Returns fileId, actual absolute path on the browser machine, byte size and MIME type. Files are saved under the browser download location using the file save directory configured in extension settings (default: automation-script), followed by the script-supplied directory. Metadata is retained in memory for 5 minutes, up to 100 files per tab; disconnect/revocation clears metadata, not saved files. Does not read file contents.',
    input: z.object({
      tabId,
      scriptId: scriptId.optional(),
      fileId: z.string().min(1).max(128).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    output: z.object({ files: z.array(savedFile) }),
    annotations: { readOnlyHint: true },
  },
};

for (const [name, definition] of Object.entries(fileTools)) {
  tools[name] = definition;
  if (!toolNames.includes(name)) toolNames.push(name);
}

export { startUpstreamServer as startServer };

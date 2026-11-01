import { encodeMcpFile } from '@/injected/content/mcp-files';
import { MCP_FILE_MAX } from '@/common/consts';

test.each([
  ['', ''],
  ['中文😀', '5Lit5paH8J+YgA=='],
  [new Uint8Array([0, 128, 255]).buffer, 'AID/'],
  [new Uint8Array([9, 0, 128, 255, 9]).subarray(1, 4), 'AID/'],
  [new DataView(new Uint8Array([9, 0, 128, 255, 9]).buffer, 1, 3), 'AID/'],
  [new Blob([new Uint8Array([0, 128, 255])]), 'AID/'],
])('encodes %p without changing file bytes', async (data, base64) => {
  expect(await encodeMcpFile({ id: 1, name: 'test.bin', data }))
  .toMatchObject({ id: 1, name: 'test.bin', dataUrl: `data:application/octet-stream;base64,${base64}` });
});

test.each([undefined, null, {}, 5, ['not', 'bytes']])('rejects unsupported file data %p', async data => {
  await expect(encodeMcpFile({ data })).rejects.toThrow(/File data must/);
});

test('rejects files above the byte limit, including multibyte text', async () => {
  await expect(encodeMcpFile({ data: new Uint8Array(MCP_FILE_MAX + 1) })).rejects.toThrow(/16 MiB/);
  await expect(encodeMcpFile({ data: '中'.repeat(Math.ceil(MCP_FILE_MAX / 3)) })).rejects.toThrow(/16 MiB/);
});

test('preserves blob MIME type and supports an explicit override', async () => {
  const data = new Blob(['x'], { type: 'text/plain;charset=utf-8' });
  expect((await encodeMcpFile({ data })).dataUrl).toBe('data:text/plain;charset=utf-8;base64,eA==');
  expect((await encodeMcpFile({ data, mimeType: 'text/csv' })).dataUrl).toBe('data:text/csv;base64,eA==');
});

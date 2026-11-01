import { MCP_FILE_MAX } from '../util';

const SafeFileReader = FileReader;
const { readAsDataURL, addEventListener: listen } = SafeFileReader[PROTO];
const getResult = describeProperty(SafeFileReader[PROTO], 'result').get;
const getSize = describeProperty(SafeBlob[PROTO], 'size').get;
const getType = describeProperty(SafeBlob[PROTO], 'type').get;
const getByteLength = describeProperty(ArrayBuffer[PROTO], 'byteLength').get;
const isView = ArrayBuffer.isView;

/** Convert binary content in the isolated realm, before Chrome's JSON messaging. */
export async function encodeMcpFile({ id, name, directory, data, mimeType }) {
  let size;
  let type;
  try {
    size = data::getSize();
    type = data::getType();
  } catch {
    if (!isString(data) && !isView(data)) {
      try { data::getByteLength(); } catch {
        throw new SafeError('File data must be a Blob, ArrayBuffer, typed array, or string');
      }
    }
    if (isString(data) && data.length > MCP_FILE_MAX) {
      throw new SafeError('File exceeds 16 MiB');
    }
    data = new SafeBlob([data]);
    size = data::getSize();
  }
  if (size > MCP_FILE_MAX) throw new SafeError('File exceeds 16 MiB');
  if (mimeType != null && !isString(mimeType)) throw new SafeError('mimeType must be a string');
  type = mimeType || type || 'application/octet-stream';
  if (type.length > 255) throw new SafeError('mimeType is too long');
  // Normalize the type using the browser's Blob implementation.
  data = new SafeBlob([data], { __proto__: null, type });
  const dataUrl = await new SafePromise((resolve, reject) => {
    const reader = new SafeFileReader();
    reader::listen('load', () => resolve(reader::getResult()));
    reader::listen('error', () => reject(new SafeError('Could not read file data')));
    reader::listen('abort', () => reject(new SafeError('File read aborted')));
    reader::readAsDataURL(data);
  });
  return { __proto__: null, id, name, directory, dataUrl };
}

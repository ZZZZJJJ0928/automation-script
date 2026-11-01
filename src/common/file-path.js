function invalid(message) {
  throw Object.assign(new Error(message), { code: 400 });
}

export function validateFileName(part) {
  // Control characters are deliberately rejected in filenames.
  // eslint-disable-next-line no-control-regex
  if (typeof part !== 'string' || !part || part.length > 255 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(part)
    || /^[. ]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
    invalid('Invalid file name or directory component');
  }
  return part;
}

/** Relative to the browser download directory; empty means that directory itself. */
export function validateFileDirectory(value) {
  if (typeof value !== 'string' || value.length > 512) {
    invalid('Directory must be a string of at most 512 characters');
  }
  if (value) value.split('/').forEach(validateFileName);
  return value;
}

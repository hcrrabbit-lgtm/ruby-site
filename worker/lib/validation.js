// Pure helpers — no D1/R2/env access. Extracted from worker/index.js as part
// of the safe, incremental modularization (see docs/architecture.md).

export function isJpegMagicBytes(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
}

export function classifySourceUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (/\.edu\.tw$/.test(host) || /\.edu\.tw\.?$/.test(host)) return "school";
    if (/\.gov\.tw$/.test(host)) return "government";
    return "community";
  } catch (e) {
    return "community";
  }
}

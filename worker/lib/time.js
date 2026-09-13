// Pure helpers — no D1/R2/env access. Extracted from worker/index.js as the
// first step of a safe, incremental modularization (see docs/architecture.md).
export function taipeiNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

export function pad(n) { return n.toString().padStart(2, "0"); }

export function taipeiDateStr(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return taipeiDateStr(d);
}

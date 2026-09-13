// Pure helper — no D1/R2/env access. Extracted from worker/index.js as the
// first step of a safe, incremental modularization (see docs/architecture.md).
export function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init && init.headers) }
  });
}

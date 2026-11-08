export const CDP_HTTP = String(
  process.env.EHTW_CDP_HTTP || 'http://127.0.0.1:9222'
).replace(/\/+$/, '');


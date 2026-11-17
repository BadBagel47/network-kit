// Cloudflare's Workers Free plan limits that the admin page compares usage with.
// Checked 2026-11-17 against Cloudflare's documentation (D-011): Workers limits
// ("Daily requests") and Durable Objects pricing (compute and SQLite storage).
// All daily counters are per account and reset at 00:00 UTC.

export const LIMITS_CHECKED = '2026-11-17';

/**
 * The metrics the page shows, in display order. `limit` is the free amount per
 * day (or in total for storage); `kind` says how a game's figure is summed.
 */
export const METRICS = [
  {
    key: 'workerRequests',
    label: 'Worker requests',
    unit: 'requests',
    limit: 100_000,
    per: 'day',
    note: 'Requests that run a Worker (static files are not counted). Over the limit, the Worker answers with error 1027 until 00:00 UTC.',
  },
  {
    key: 'doRequests',
    label: 'Room requests',
    unit: 'requests',
    limit: 100_000,
    per: 'day',
    note: 'Durable Object requests: connections, alarms and incoming WebSocket messages. Cloudflare bills incoming WebSocket messages at 1 in 20, so the billed figure is lower than this count.',
  },
  {
    key: 'doDuration',
    label: 'Room time',
    unit: 'GB-s',
    limit: 13_000,
    per: 'day',
    note: 'Durable Object duration: wall-clock time while a room is active, at 128 MB. Hibernating rooms are not counted.',
  },
  {
    key: 'rowsRead',
    label: 'Rows read',
    unit: 'rows',
    limit: 5_000_000,
    per: 'day',
    note: 'Rows read from room storage.',
  },
  {
    key: 'rowsWritten',
    label: 'Rows written',
    unit: 'rows',
    limit: 100_000,
    per: 'day',
    note: 'Rows written to room storage; deletes and alarms count as writes.',
  },
  {
    key: 'storedBytes',
    label: 'Stored data',
    unit: 'bytes',
    limit: 5 * 1000 ** 3,
    per: 'total',
    note: 'Room storage kept on the account (5 GB in total on the Free plan).',
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);

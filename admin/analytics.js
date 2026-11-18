// Usage per game from Cloudflare's GraphQL Analytics API.
//
// The datasets' exact field names are not all documented, so the module first
// asks the API which fields each dataset has (introspection) and builds its
// queries from what is there. Each dataset is queried on its own: one that
// fails leaves a note and the rest of the page still works.
//
// Needs an API token with "Account Analytics: Read" (and "Workers Scripts:
// Read" when room usage is only reported per Durable Object namespace).

import { METRIC_KEYS } from './limits.js';

export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
export const API_URL = 'https://api.cloudflare.com/client/v4';

/** The row for usage that Cloudflare reports without a Worker's name. */
export const UNNAMED = 'Not named by Cloudflare';

/**
 * Figures kept beside the metrics (B-069): all room requests as Cloudflare's
 * statistics count them, and the incoming WebSocket messages among them.
 */
export const EXTRA_KEYS = ['doRequestsAll', 'doMessages', 'errors'];

/** Cloudflare counts this many incoming WebSocket messages as one room request. */
export const MESSAGES_PER_REQUEST = 20;

/** Duration is billed for 128 MB per active Durable Object. */
const GB_PER_OBJECT = 128 / 1024;

// What each metric is read from, in order of preference.
const DATASETS = {
  workers: {
    name: 'workersInvocationsAdaptive',
    owners: ['scriptName'],
    fields: { sum: ['requests', 'errors'] },
  },
  invocations: {
    name: 'durableObjectsInvocationsAdaptiveGroups',
    // Rooms are best tied to their game through the namespace: the script
    // name is not always filled in for room requests.
    owners: ['namespaceId', 'scriptName'],
    // The kind of call (http, alarm, hibernation, ...): incoming WebSocket
    // messages to hibernating rooms are "hibernation" calls (B-069).
    split: 'type',
    fields: { sum: ['requests', 'errors'] },
  },
  periodic: {
    name: 'durableObjectsPeriodicGroups',
    owners: ['namespaceId', 'scriptName'],
    fields: { sum: ['activeTime', 'duration', 'rowsRead', 'rowsWritten', 'inboundWebsocketMsgCount'] },
  },
  storage: {
    name: 'durableObjectsStorageGroups',
    owners: ['namespaceId', 'scriptName'],
    fields: { max: ['storedBytes'] },
  },
};
const DAY_DIMENSIONS = ['date', 'datetimeDay', 'datetimeHour', 'datetimeMinute', 'datetime'];

/** YYYY-MM-DD of a time, in UTC (Cloudflare's daily limits reset at 00:00 UTC). */
export const utcDate = (t) => new Date(t).toISOString().slice(0, 10);

/** The last `days` UTC dates up to and including today, oldest first. */
export function lastDays(now, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(utcDate(now - i * 86_400_000));
  return out;
}

const unwrap = (t) => {
  while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
  return t;
};

const TYPE_REF = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';

export class CloudflareAnalytics {
  /**
   * @param {object} o
   * @param {string} o.token        API token (read-only).
   * @param {string} [o.accountId]  Account id; looked up with the token when missing.
   * @param {typeof fetch} [o.fetch]
   * @param {() => number} [o.now]
   */
  constructor({ token, accountId = null, fetch: f = globalThis.fetch, now = Date.now }) {
    this.token = token;
    this.accountId = accountId || null;
    this.fetch = f;
    this.now = now;
    this.types = new Map();
    this.shapes = null;
  }

  async api(path) {
    const res = await this.fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${this.token}` } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const why = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(`${path}: ${why}`);
    }
    return body.result;
  }

  async graphql(query, variables = {}) {
    const res = await this.fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => null);
    if (!body) throw new Error(`GraphQL: HTTP ${res.status}`);
    if (body.errors?.length && !body.data) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    if (body.errors?.length) body.partialErrors = body.errors.map((e) => e.message);
    return body;
  }

  async account() {
    if (this.accountId) return this.accountId;
    const accounts = await this.api('/accounts?per_page=5');
    if (!accounts?.length) throw new Error('The token can see no account; give it access to the account.');
    this.accountId = accounts[0].id;
    return this.accountId;
  }

  /** One GraphQL type with its fields, args and input fields (cached). */
  async type(name) {
    if (this.types.has(name)) return this.types.get(name);
    const { data } = await this.graphql(
      `query ($n: String!) { __type(name: $n) { name fields { name type { ${TYPE_REF} } args { name type { ${TYPE_REF} } } } inputFields { name } } }`,
      { n: name },
    );
    const t = data?.__type ?? null;
    this.types.set(name, t);
    return t;
  }

  async fieldType(typeName, fieldName) {
    const t = await this.type(typeName);
    const f = t?.fields?.find((x) => x.name === fieldName);
    return f ? { field: f, type: unwrap(f.type) } : null;
  }

  /**
   * Which fields each dataset offers: the per-day and per-game dimensions, the
   * metric fields, and how to filter by date. Asked once and kept.
   */
  async discover() {
    if (this.shapes) return this.shapes;
    const { data } = await this.graphql('{ __schema { queryType { name } } }');
    const queryType = data.__schema.queryType.name;
    const viewer = await this.fieldType(queryType, 'viewer');
    const accounts = viewer && (await this.fieldType(viewer.type.name, 'accounts'));
    if (!accounts) throw new Error('GraphQL: viewer.accounts not found');
    const accountType = accounts.type.name;
    const shapes = {};
    for (const [key, ds] of Object.entries(DATASETS)) {
      const found = await this.fieldType(accountType, ds.name);
      if (!found) {
        shapes[key] = { missing: `${ds.name} is not offered to this account or token` };
        continue;
      }
      const groupType = found.type.name;
      const filterArg = found.field.args.find((a) => a.name === 'filter');
      const filterFields = filterArg ? ((await this.type(unwrap(filterArg.type).name))?.inputFields ?? []).map((f) => f.name) : [];
      const dims = await this.fieldType(groupType, 'dimensions');
      const dimNames = dims ? ((await this.type(dims.type.name))?.fields ?? []).map((f) => f.name) : [];
      const shape = {
        name: ds.name,
        day: DAY_DIMENSIONS.find((d) => dimNames.includes(d)) ?? null,
        owner: ds.owners.find((d) => dimNames.includes(d)) ?? null,
        dateFilter: filterFields.includes('date_geq') ? 'date' : filterFields.includes('datetime_geq') ? 'datetime' : null,
        split: ds.split && dimNames.includes(ds.split) ? ds.split : null,
        values: {},
      };
      for (const [block, wanted] of Object.entries(ds.fields)) {
        const blockType = await this.fieldType(groupType, block);
        const names = blockType ? ((await this.type(blockType.type.name))?.fields ?? []).map((f) => f.name) : [];
        shape.values[block] = wanted.filter((w) => names.includes(w));
      }
      shapes[key] = shape;
    }
    this.shapes = shapes;
    return shapes;
  }

  /** How many days back each dataset may be asked for (settings), when offered. */
  async retention(accountTag, shapes) {
    const names = Object.values(shapes).filter((s) => s.name).map((s) => s.name);
    const parts = names.map((n) => `${n} { notOlderThan maxDuration }`).join(' ');
    try {
      const { data } = await this.graphql(
        `query ($a: String!) { viewer { accounts(filter: { accountTag: $a }) { settings { ${parts} } } } }`,
        { a: accountTag },
      );
      return data?.viewer?.accounts?.[0]?.settings ?? {};
    } catch {
      return {};
    }
  }

  async queryDataset(accountTag, shape, from, to) {
    const blocks = Object.entries(shape.values)
      .filter(([, names]) => names.length)
      .map(([block, names]) => `${block} { ${names.join(' ')} }`)
      .join(' ');
    const dims = [shape.day, shape.owner, shape.split].filter(Boolean).join(' ');
    const filter = shape.dateFilter === 'datetime'
      ? `{ datetime_geq: "${from}T00:00:00Z", datetime_leq: "${to}T23:59:59Z" }`
      : `{ date_geq: "${from}", date_leq: "${to}" }`;
    const query = `query ($a: String!) { viewer { accounts(filter: { accountTag: $a }) {
      ${shape.name}(limit: 10000, filter: ${filter}) { ${blocks} dimensions { ${dims} } } } } }`;
    const body = await this.graphql(query, { a: accountTag });
    return { rows: body.data?.viewer?.accounts?.[0]?.[shape.name] ?? [], warnings: body.partialErrors ?? [] };
  }

  /** Durable Object namespace id → the Worker (game) it belongs to. */
  async namespaces(accountTag) {
    const list = await this.api(`/accounts/${accountTag}/workers/durable_objects/namespaces?per_page=1000`);
    const map = new Map();
    for (const ns of list ?? []) map.set(ns.id, ns.script || ns.name || ns.id);
    return map;
  }

  /**
   * Usage per game and day for the last `days` days.
   * @returns {Promise<object>} see buildUsage
   */
  async usage({ days = 31 } = {}) {
    const now = this.now();
    const accountTag = await this.account();
    const shapes = await this.discover();
    const notes = [];
    const settings = await this.retention(accountTag, shapes);
    const dates = lastDays(now, days);
    const results = {};
    let namespaceMap = null;
    for (const [key, shape] of Object.entries(shapes)) {
      if (shape.missing) {
        notes.push(shape.missing);
        continue;
      }
      if (!shape.day || !shape.dateFilter) {
        notes.push(`${shape.name}: no per-day field to group by`);
        continue;
      }
      // Ask only for the days the dataset keeps.
      let from = dates[0];
      const older = settings?.[shape.name]?.notOlderThan;
      if (older) {
        const oldest = utcDate(now - Number(older) * 1000 + 86_400_000);
        if (oldest > from) from = oldest;
      }
      try {
        const { rows, warnings } = await this.queryDataset(accountTag, shape, from, dates[dates.length - 1]);
        results[key] = rows;
        notes.push(...warnings.map((w) => `${shape.name}: ${w}`));
      } catch (e) {
        notes.push(`${shape.name}: ${e.message}`);
        continue;
      }
      if (shape.owner === 'namespaceId' && !namespaceMap) {
        try {
          namespaceMap = await this.namespaces(accountTag);
        } catch (e) {
          namespaceMap = new Map();
          notes.push(`Room usage is shown per namespace: ${e.message}`);
        }
      }
    }
    const usage = buildUsage({ now, dates, shapes, results, namespaceMap, notes });
    // When each Worker was last deployed (F-074).
    try {
      usage.deployed = Object.fromEntries((await this.api(`/accounts/${accountTag}/workers/scripts`) ?? []).map((w) => [w.id, w.modified_on ?? null]));
    } catch (e) {
      usage.deployed = {};
      usage.notes.push(`Deploy times: ${e.message}`);
    }
    // Rooms and players now and today's peak (F-072).
    try {
      if (!namespaceMap) namespaceMap = await this.namespaces(accountTag);
      const day = utcDate(now);
      const q = `query ($a: String!, $d: Date!) { viewer { accounts(filter: { accountTag: $a }) {
        durableObjectsPeriodicGroups(limit: 10000, filter: { date_geq: $d, date_leq: $d }) { max { activeWebsocketConnections } dimensions { namespaceId objectId datetimeFiveMinutes } } } } }`;
      const body = await this.graphql(q, { a: accountTag, d: day });
      usage.activity = activityFrom(body.data?.viewer?.accounts?.[0]?.durableObjectsPeriodicGroups ?? [], namespaceMap, now);
    } catch (e) {
      usage.activity = {};
      usage.notes.push(`Rooms and players: ${e.message}`);
    }
    return usage;
  }
}

/**
 * Rooms and players per game from the rooms' open connections (F-072): now is
 * the newest five minutes within the last 15 (Cloudflare's figures lag), the
 * peak is the busiest five minutes today. Players are connections, so a
 * viewer or a second tab counts too.
 */
export function activityFrom(rows, namespaceMap, now) {
  const buckets = new Map(); // game → time → { rooms, players }
  for (const r of rows) {
    const c = r.max?.activeWebsocketConnections ?? 0;
    if (!c) continue;
    const game = namespaceMap?.get(r.dimensions?.namespaceId) ?? `namespace ${String(r.dimensions?.namespaceId).slice(0, 8)}`;
    const at = Date.parse(r.dimensions?.datetimeFiveMinutes);
    if (!Number.isFinite(at)) continue;
    if (!buckets.has(game)) buckets.set(game, new Map());
    const b = buckets.get(game);
    const cur = b.get(at) ?? { rooms: 0, players: 0 };
    cur.rooms += 1;
    cur.players += c;
    b.set(at, cur);
  }
  const out = {};
  for (const [game, b] of buckets) {
    let peak = 0;
    let latest = null;
    for (const [at, v] of b) {
      peak = Math.max(peak, v.players);
      if (now - at <= 15 * 60_000 && (!latest || at > latest.at)) latest = { at, ...v };
    }
    out[game] = { rooms: latest?.rooms ?? 0, players: latest?.players ?? 0, peak, at: latest ? new Date(latest.at).toISOString() : null };
  }
  return out;
}

/**
 * Turn the datasets' rows into one table: games × metrics × days.
 * Pure, so it is tested without the API.
 */
export function buildUsage({ now, dates, shapes, results, namespaceMap = null, notes = [] }) {
  const games = new Map();
  const game = (name) => {
    if (!games.has(name)) {
      const daily = {};
      for (const k of [...METRIC_KEYS, ...EXTRA_KEYS]) daily[k] = Object.fromEntries(dates.map((d) => [d, 0]));
      games.set(name, { name, daily });
    }
    return games.get(name);
  };
  const ownerOf = (shape, dims) => {
    const raw = dims?.[shape.owner];
    if (!shape.owner) return 'All games';
    if (shape.owner === 'namespaceId') return namespaceMap?.get(raw) ?? `namespace ${String(raw).slice(0, 8)}`;
    // Cloudflare reports some requests without a Worker's name.
    return raw && raw !== '__unknown__' ? raw : UNNAMED;
  };
  const dayOf = (shape, dims) => String(dims?.[shape.day] ?? '').slice(0, 10);
  const add = (shape, rows, pick) => {
    for (const row of rows ?? []) {
      const d = dayOf(shape, row.dimensions);
      const g = game(ownerOf(shape, row.dimensions));
      for (const [key, value] of Object.entries(pick(row))) {
        if (!(d in g.daily[key]) || !Number.isFinite(value)) continue;
        g.daily[key][d] += value;
      }
    }
  };
  const has = (shape, block, name) => shape?.values?.[block]?.includes(name);
  const available = new Set();

  if (results.workers) {
    available.add('workerRequests');
    add(shapes.workers, results.workers, (r) => ({ workerRequests: r.sum?.requests ?? 0, errors: r.sum?.errors ?? 0 }));
  }
  if (results.invocations) {
    available.add('doRequests');
    const split = shapes.invocations.split;
    add(shapes.invocations, results.invocations, (r) => ({
      doRequestsAll: r.sum?.requests ?? 0,
      errors: r.sum?.errors ?? 0, // failed calls to rooms (F-074)
      // Calls that delivered an incoming WebSocket message to a hibernating room.
      ...(split && r.dimensions?.[split] === 'hibernation' ? { doMessages: r.sum?.requests ?? 0 } : {}),
    }));
  }
  if (results.periodic) {
    const p = shapes.periodic;
    if (has(p, 'sum', 'activeTime') || has(p, 'sum', 'duration')) available.add('doDuration');
    if (has(p, 'sum', 'rowsRead')) available.add('rowsRead');
    if (has(p, 'sum', 'rowsWritten')) available.add('rowsWritten');
    add(p, results.periodic, (r) => ({
      // activeTime is in microseconds; duration is already in GB-s.
      doDuration: has(p, 'sum', 'activeTime')
        ? ((r.sum?.activeTime ?? 0) / 1e6) * GB_PER_OBJECT
        : r.sum?.duration ?? 0,
      rowsRead: r.sum?.rowsRead ?? 0,
      rowsWritten: r.sum?.rowsWritten ?? 0,
      // Messages to rooms that do not hibernate (reported 0 for hibernating ones).
      ...(shapes.invocations?.split ? {} : { doMessages: r.sum?.inboundWebsocketMsgCount ?? 0 }),
    }));
  }
  // Room requests as Cloudflare counts them against the free limit (B-069):
  // the statistics count every incoming WebSocket message as a request, but
  // 20 of them count as one; connections, alarms and other calls count fully.
  // Messages are known from the kind of call ("hibernation"), else from the
  // periodic message count.
  const messagesKnown = Boolean(shapes.invocations?.split) || has(shapes.periodic, 'sum', 'inboundWebsocketMsgCount');
  if (results.invocations && !messagesKnown) notes.push('Room requests: incoming WebSocket messages are not reported, so each is counted as a whole request.');
  for (const g of games.values()) {
    for (const d of dates) {
      const all = g.daily.doRequestsAll[d];
      const messages = messagesKnown ? Math.min(g.daily.doMessages[d], all) : 0;
      g.daily.doRequests[d] = all - messages + messages / MESSAGES_PER_REQUEST;
    }
  }
  if (results.storage) {
    available.add('storedBytes');
    // Stored data is a level, not a flow: the largest value per owner and day
    // (also when the dataset reports per hour), then added up per game.
    const s = shapes.storage;
    const peaks = new Map();
    for (const row of results.storage) {
      const d = dayOf(s, row.dimensions);
      const k = `${row.dimensions?.[s.owner] ?? ''}\u0000${d}`;
      const prev = peaks.get(k);
      const v = row.max?.storedBytes ?? 0;
      if (!prev || v > prev.v) peaks.set(k, { row, v });
    }
    add(s, [...peaks.values()].map((p) => p.row), (r) => ({ storedBytes: r.max?.storedBytes ?? 0 }));
  }

  const list = [...games.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: new Date(now).toISOString(),
    today: utcDate(now),
    dates,
    available: METRIC_KEYS.filter((k) => available.has(k)),
    games: list,
    notes,
  };
}

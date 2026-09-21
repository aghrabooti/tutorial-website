// Minimal in-memory stand-in for @supabase/supabase-js (already-unique client).
// Implements the fluent subset used by the edge functions.

export const DB = {
  orders: [],
  shipments: [],
  user_addresses: [],
  courses: [],
  site_users: [],
  user_sessions: [],
  cart_items: [],
};

export const LOG = [];

function match(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === "eq") return String(v) === String(val);
    if (op === "in") return val.map(String).includes(String(v));
    return true;
  });
}

class Builder {
  constructor(table, mode, payload) {
    this.table = table;
    this.mode = mode; // select | insert | update
    this.payload = payload;
    this.filters = [];
    this._order = null;
    this._limit = null;
    this._single = null;
    this._selectCols = "*";
    this._head = false;
    this._count = null;
  }

  select(cols = "*", opts = {}) {
    this._selectCols = cols;
    this._head = !!opts.head;
    this._count = opts.count ?? null;
    return this;
  }

  eq(col, val) { this.filters.push(["eq", col, val]); return this; }
  in(col, val) { this.filters.push(["in", col, val]); return this; }
  order(col, opts = {}) { this._order = { col, asc: opts.ascending !== false }; return this; }
  limit(n) { this._limit = n; return this; }
  maybeSingle() { this._single = "maybe"; return this._run(); }
  single() { this._single = "one"; return this._run(); }

  then(resolve, reject) { return this._run().then(resolve, reject); }

  async _run() {
    await new Promise((r) => setTimeout(r, 0));
    const rows = DB[this.table];
    if (!rows) return { data: null, error: { message: `table ${this.table} missing` } };

    if (this.mode === "insert" && globalThis.__FAIL_INSERT?.[this.table]) {
      return { data: null, error: { message: globalThis.__FAIL_INSERT[this.table], code: "23502" } };
    }

    if (this.mode === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const now = new Date().toISOString();
      const created = list.map((p, i) => ({
        id: p.id ?? `id-${this.table}-${rows.length + i + 1}`,
        created_at: p.created_at ?? now,
        updated_at: p.updated_at ?? now,
        ...p,
      }));
      rows.push(...created);
      LOG.push(`insert ${this.table} ${JSON.stringify(list)}`);
      const data = this._single ? created[0] : created;
      return { data: this._selectCols === "*" || this.mode !== "insert" ? data : pick(data, this._selectCols), error: null };
    }

    if (this.mode === "delete") {
      const keep = rows.filter((r) => !match(r, this.filters));
      const removed = rows.length - keep.length;
      DB[this.table] = keep;
      LOG.push(`delete ${this.table} (${removed} rows)`);
      return { data: null, error: null };
    }

    if (this.mode === "update") {
      const hits = rows.filter((r) => match(r, this.filters));
      hits.forEach((r) => Object.assign(r, this.payload));
      LOG.push(`update ${this.table} (${hits.length} rows)`);
      return { data: this._single ? hits[0] ?? null : hits, error: null };
    }

    // select
    let out = rows.filter((r) => match(r, this.filters));

    if (this._order) {
      const { col, asc } = this._order;
      out = [...out].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : av < bv ? 1 : av > bv ? -1 : 0;
      });
    }

    if (this._limit) out = out.slice(0, this._limit);

    if (this._single) {
      return { data: out[0] ?? null, error: null };
    }

    const data = this._selectCols === "*" ? out : out.map((r) => pick(r, this._selectCols));

    return {
      data: this._head ? null : data,
      count: this._count ? out.length : null,
      error: null,
    };
  }
}

// parse "id, course_id, courses(id, title)" → [{col:'id'}, {col:'course_id'}, {rel:'courses', cols:'id, title'}]
function parseCols(cols) {
  const parts = [];
  let depth = 0;
  let buf = "";
  for (const ch of cols) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());

  return parts.filter(Boolean).map((p) => {
    const m = p.match(/^([\w]+)\(([\s\S]*)\)$/);
    if (m) return { rel: m[1], cols: m[2].trim() };
    return { col: p.split(":").slice(-1)[0].trim() };
  });
}

// minimal resource embedding: "courses(...)" → DB.courses joined on <rel-singular>_id
function pick(row, cols) {
  const out = {};
  for (const spec of parseCols(cols)) {
    if (spec.col) {
      out[spec.col] = row[spec.col];
      continue;
    }
    const singular = spec.rel.replace(/s$/, "");
    const fk = row[`${singular}_id`] ?? row[`${spec.rel}_id`];
    const table = DB[spec.rel] ?? [];
    const related = table.find((r) => String(r.id) === String(fk));
    out[spec.rel] = related ? pick(related, spec.cols) : null;
  }
  return out;
}

export function createClient() {
  return {
    from(table) {
      return {
        select: (cols, opts) => new Builder(table, "select").select(cols, opts),
        insert: (payload) => new Builder(table, "insert", payload),
        delete: () => new Builder(table, "delete"),
        update: (payload) => new Builder(table, "update", payload),
      };
    },
  };
}
const _origFrom = createClient;

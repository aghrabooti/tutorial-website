import { createFileStore } from "./file-store.js";

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

class Query {
  constructor(url) {
    this.url = url;
    this.method = "GET";
    this.preferences = [];
  }

  select(columns = "*", { count, head } = {}) {
    this.url.searchParams.set("select", columns.replace(/\s/g, ""));
    if (count) this.preferences.push(`count=${count}`);
    if (head) this.method = "HEAD";
    else if (this.method !== "GET") this.preferences.push("return=representation");
    return this;
  }

  filter(column, operator, value) {
    this.url.searchParams.append(column, `${operator}.${value}`);
    return this;
  }

  eq(column, value) { return this.filter(column, "eq", value); }
  neq(column, value) { return this.filter(column, "neq", value); }
  in(column, values) { return this.filter(column, "in", `(${values.map(value => JSON.stringify(String(value))).join(",")})`); }
  overlaps(column, values) { return this.filter(column, "ov", `{${values.map(value => JSON.stringify(String(value))).join(",")}}`); }

  order(column, { ascending = true } = {}) {
    this.url.searchParams.set("order", `${column}.${ascending ? "asc" : "desc"}`);
    return this;
  }

  limit(count) {
    this.url.searchParams.set("limit", String(count));
    return this;
  }

  mutate(method, body) {
    this.method = method;
    this.body = body;
    return this;
  }

  insert(body) { return this.mutate("POST", body); }
  update(body) { return this.mutate("PATCH", body); }
  delete() { return this.mutate("DELETE"); }

  upsert(body, { onConflict } = {}) {
    this.preferences.push("resolution=merge-duplicates", "missing=default");
    if (onConflict) this.url.searchParams.set("on_conflict", onConflict);
    return this.insert(body);
  }

  async fetch() {
    try {
      const response = await fetch(this.url, {
        method: this.method,
        headers: {
          "Content-Type": "application/json",
          Prefer: this.preferences.join(","),
        },
        body: JSON.stringify(this.body),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const rawCount = response.headers.get("content-range")?.split("/")[1];
      const count = rawCount && rawCount !== "*" ? Number(rawCount) : null;
      const raw = this.method === "HEAD" ? "" : await response.text();
      const payload = raw ? JSON.parse(raw) : null;
      if (!response.ok) return { data: null, error: payload ?? { message: `Database request failed (${response.status})` }, count: null };
      return { data: payload, error: null, count };
    } catch (error) {
      return { data: null, error: { message: error.message }, count: null };
    }
  }

  async one(required) {
    const result = await this.fetch();
    if (result.error) return result;
    if (result.data?.length === 1) return { ...result, data: result.data[0] };
    if (!required && result.data?.length === 0) return { ...result, data: null };
    return { data: null, error: { code: "PGRST116", message: "Unexpected number of database rows" } };
  }

  single() { return this.one(true); }
  maybeSingle() { return this.one(false); }
  then(resolve, reject) { return this.fetch().then(resolve, reject); }
}

export function createDatabase() {
  return {
    from(table) {
      const base = requiredEnv("DATABASE_API_URL").replace(/\/+$/, "");
      return new Query(new URL(`${base}/${encodeURIComponent(table)}`));
    },
    rpc(name, args) {
      const base = requiredEnv("DATABASE_API_URL").replace(/\/+$/, "");
      return new Query(new URL(`${base}/rpc/${encodeURIComponent(name)}`)).insert(args);
    },
    storage: createFileStore(),
  };
}

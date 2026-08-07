export class SoqlRunner {
  constructor(client) { this.client = client; }
  async run(soql, { tooling = false, all = true } = {}) { const result = await this.client.query(soql.trim(), { tooling, all }); const rows = (result.records || []).map(flatten); const columns = derive(rows); return { columns, rows, totalSize: result.totalSize ?? rows.length, done: result.done !== false }; }
  toCsv(columns, rows) { const esc = (v) => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return `${columns.map(esc).join(",")}\n${rows.map((r) => columns.map((c) => esc(r[c])).join(",")).join("\n")}`; }
}
function flatten(rec, prefix = "") { const out = {}; for (const [k, v] of Object.entries(rec)) { if (k === "attributes") continue; const key = prefix ? `${prefix}.${k}` : k; if (v && typeof v === "object" && !Array.isArray(v) && v.attributes) Object.assign(out, flatten(v, key)); else if (v && typeof v === "object" && Array.isArray(v.records)) out[key] = `[${v.totalSize} rows]`; else out[key] = v; } return out; }
function derive(rows) { const s = []; for (const r of rows) for (const k of Object.keys(r)) if (!s.includes(k)) s.push(k); return s; }

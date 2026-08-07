/* inspector.js — Salesforce Inspector tools (SOQL Export, Data Import, Show All Data)
   ported into OrgStudio. Data layer uses OrgStudio's authenticated SFClient (app.client).

   SOQL Export update: the autocomplete suggestions and the result output now match the
   real Salesforce Inspector experience — context-aware object/field/relationship
   suggestions (with dot-notation traversal), and relationship-flattened output columns
   (e.g. Account.Name) with child sub-queries shown as "[N rows]". No UI/markup changes. */
import { escapeHtml } from "../common/util.js";
import { Icons } from "../ide/icons.js";

const ID = /^[A-Za-z0-9]{15,18}$/;
const esc = (v) => escapeHtml(v);
function keys(rows) { return [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== "attributes")))]; }

/* Flatten a Salesforce record like the real Inspector export:
   - parent relationships (nested object with `attributes`) -> dotted columns (Account.Name)
   - child sub-queries (nested object with `records`)        -> "[N rows]"
   - other objects/arrays                                    -> JSON string */
function flattenRow(rec, prefix, out) {
  for (const [k, v] of Object.entries(rec)) {
    if (k === "attributes") continue;
    const key = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v.attributes) flattenRow(v, key, out);
      else if (Array.isArray(v.records)) out[key] = `[${v.totalSize ?? v.records.length} rows]`;
      else out[key] = JSON.stringify(v);
    } else if (Array.isArray(v)) out[key] = JSON.stringify(v);
    else out[key] = v;
  }
  return out;
}
function tsvRows(rows) { const k = keys(rows); return [k.join("\t"), ...rows.map((r) => k.map((x) => String(r[x] ?? "").replace(/\t|\r?\n/g, " ")).join("\t"))].join("\n"); }
function csvRows(rows) { const k = keys(rows); return [k.join(","), ...rows.map((r) => k.map((x) => JSON.stringify(r[x] ?? "")).join(","))].join("\n"); }
function download(name, text, type = "text/plain") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
function flat(rec) { const out = {}; for (const [k, v] of Object.entries(rec)) { if (k === "attributes") continue; out[k] = v && typeof v === "object" ? JSON.stringify(v) : v; } return out; }

/* Data layer backed by OrgStudio's SFClient — mirrors Inspector's background API. */
function sf(app) {
  const c = app.client;
  return {
    instanceUrl: c.instanceUrl,
    objects: () => c.describeGlobal(),
    describe: (n) => c.describeSObject(n),
    query: (soql) => c.query(soql, { all: false }),
    queryAll: (soql) => c.query(soql, { all: true }),
    updateRecord: (obj, id, fields) => c.restUpdate(obj, id, fields),
    deleteRecord: (obj, id) => c.restDelete(obj, id),
    async resolveObjectFromId(id) { const g = await c.describeGlobal(); const p = (id || "").slice(0, 3); const m = (g.sobjects || []).find((o) => o.keyPrefix === p); if (!m) throw new Error(`Could not resolve object from Id prefix ${p}.`); return m.name; },
    async recordDetails(obj, id) { if (!obj) obj = await this.resolveObjectFromId(id); const [describe, record] = await Promise.all([c.describeSObject(obj), c.restRetrieve(obj, id)]); return { objectName: obj, recordId: id, instanceUrl: c.instanceUrl, describe, record }; },
    async bulkAction({ objectName, records, operation = "insert", allOrNone = false, externalIdField }) {
      const results = [];
      for (let i = 0; i < records.length; i += 200) {
        const chunk = records.slice(i, i + 200);
        if (operation === "insert") { const payload = chunk.map((r) => ({ attributes: { type: objectName }, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => k.toLowerCase() !== "id" && v !== "")) })); results.push(...(await c.compositeCreate(payload, allOrNone))); }
        else if (operation === "update") { const payload = chunk.map((r) => ({ attributes: { type: objectName }, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")) })); results.push(...(await c.compositeUpdate(payload, allOrNone))); }
        else if (operation === "upsert") { if (!externalIdField) throw new Error("Choose an external Id field for Upsert."); for (const r of chunk) { const val = r[externalIdField]; if (!val) { results.push({ success: false, errors: [{ message: `Missing ${externalIdField}` }] }); continue; } const body = Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== externalIdField && v !== "")); try { await c.upsertByExternalId(objectName, externalIdField, val, body); results.push({ success: true, id: val, errors: [] }); } catch (e) { results.push({ success: false, id: val, errors: [{ message: e.message }] }); } } }
        else if (operation === "delete") { const ids = chunk.map((r) => r.Id || r.id || r.ID); results.push(...(await c.compositeDelete(ids, allOrNone))); }
        else if (operation === "undelete") { for (const r of chunk) { const id = r.Id || r.id || r.ID; try { const data = await c.undelete(id); results.push({ success: true, id, result: data, errors: [] }); } catch (e) { results.push({ success: false, id, errors: [{ message: e.message }] }); } } }
      }
      return { attempted: records.length, succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results };
    },
  };
}

function openOverlay(title, iconKey) {
  const el = document.createElement("div"); el.className = "insp-overlay";
  el.innerHTML = `<div class="insp-head"><span class="insp-title"><span class="insp-ico">${Icons[iconKey] || Icons.db}</span>${esc(title)}</span><span class="insp-conn" id="inspConn"></span><span class="spacer"></span><button class="btn ghost sm" id="inspClose">✕ Close</button></div><div class="insp-body" id="inspBody"></div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector("#inspClose").onclick = close;
  const onEsc = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } };
  document.addEventListener("keydown", onEsc);
  return { el, body: el.querySelector("#inspBody"), conn: el.querySelector("#inspConn"), close };
}

/* ============================================================ SOQL EXPORT */
export function openSoqlExport(app) {
  const api = sf(app);
  const ov = openOverlay("SOQL Export", "exportData");
  ov.conn.textContent = api.instanceUrl ? `Connected · ${new URL(api.instanceUrl).hostname}` : "";
  const st = { objects: [], fields: {}, queryRows: [], filtered: [] };
  ov.body.innerHTML = `
    <div class="insp-card">
      <div class="insp-row" style="margin-bottom:8px">
        <select class="insp-select" id="sxHistory" style="min-width:150px"></select>
        <select class="insp-select" id="sxFav" style="min-width:150px"></select>
        <button class="btn ghost sm" id="sxFavorite">☆ Favorite</button>
        <span class="spacer" style="flex:1"></span>
        <label class="insp-label" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sxAll"> Query all pages</label>
      </div>
      <div class="insp-editor-wrap">
        <textarea class="insp-textarea insp-q" id="sxQuery" spellcheck="false">SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 50</textarea>
        <div class="insp-suggest" id="sxSuggest"></div>
      </div>
      <div class="insp-row" style="margin-top:8px">
        <button class="btn primary sm" id="sxRun">${Icons.play} Run Export</button>
        <button class="btn ghost sm" id="sxFormat">Format Query</button>
        <button class="btn ghost sm" id="sxDownloadQuery">Export Query</button>
        <span class="insp-error insp-hide" id="sxErr" style="flex:1"></span>
      </div>
    </div>
    <div class="insp-card">
      <div class="insp-row" style="margin-bottom:8px">
        <input class="insp-input" id="sxFilter" placeholder="Filter results…" style="flex:1;min-width:180px">
        <button class="btn ghost sm" id="sxCopyExcel">Copy Excel</button>
        <button class="btn ghost sm" id="sxCopyCsv">Copy CSV</button>
        <button class="btn ghost sm" id="sxCopyJson">Copy JSON</button>
        <button class="btn ghost sm" id="sxDownload">Download CSV</button>
        <button class="btn danger sm" id="sxDelete">Delete Selected Records</button>
        <span class="insp-label" id="sxCount"></span>
      </div>
      <div class="insp-tablewrap" id="sxResult"><div class="empty-state" style="padding:22px">Run a query to see results.</div></div>
    </div>`;
  const $ = (id) => ov.body.querySelector("#" + id);
  if (app.settings && app.settings.defaultQueryAll) $("sxAll").checked = true;
  const fromObj = () => ($("sxQuery").value.match(/\bFROM\s+([\w]+)\b/i) || [])[1] || "";

  async function loadObjects() { try { const d = await api.objects(); st.objects = (d.sobjects || []).filter((o) => o.queryable).map((o) => ({ name: o.name, label: o.label })); } catch { } }
  async function ensureFields(obj) { if (!obj || st.fields[obj]) return; try { const d = await api.describe(obj); st.fields[obj] = (d.fields || []).map((f) => ({ name: f.name, label: f.label, type: f.type, relationshipName: f.relationshipName || null, referenceTo: f.referenceTo || [] })); } catch { } }
  async function resolvePath(baseObj, rels) { let cur = baseObj; for (const rel of rels) { await ensureFields(cur); const fields = st.fields[cur] || []; const match = fields.find((f) => f.relationshipName && f.relationshipName.toLowerCase() === rel.toLowerCase()); if (!match || !match.referenceTo || !match.referenceTo.length) return null; cur = match.referenceTo[0]; } await ensureFields(cur); return cur; }

  const SOQL_KEYWORDS = ["SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET", "ASC", "DESC", "NULLS FIRST", "NULLS LAST", "IN", "NOT IN", "LIKE", "INCLUDES", "EXCLUDES", "COUNT()", "FIELDS(ALL)", "FIELDS(STANDARD)", "FIELDS(CUSTOM)", "TYPEOF", "USING SCOPE", "FOR VIEW", "FOR REFERENCE", "FOR UPDATE"];
  function token() { const e = $("sxQuery"); const p = e.selectionStart; let s = p; const t = e.value; while (s > 0 && /[\w.]/.test(t[s - 1])) s--; let end = p; while (end < t.length && /[\w.]/.test(t[end])) end++; return { q: t.slice(s, p), s, end }; }

  async function suggest() {
    const el = $("sxQuery"); const t = token(); const before = el.value.slice(0, t.s); const obj = fromObj();
    const box = $("sxSuggest"); let items = [];
    if (/\bFROM\s+$/i.test(before)) {
      // Typing the primary object right after FROM -> suggest sObjects.
      const q = t.q.toLowerCase();
      items = st.objects.filter((o) => !q || o.name.toLowerCase().startsWith(q)).slice(0, 60).map((o) => ({ v: o.name, m: "Object · " + o.label, s: t.s, e: t.end }));
    } else if (obj) {
      await ensureFields(obj);
      const q = t.q; const dot = q.lastIndexOf(".");
      if (dot >= 0) {
        // Relationship dot-notation: resolve the path then suggest the target object's fields/relationships.
        const path = q.slice(0, dot).split("."); const frag = q.slice(dot + 1).toLowerCase(); const insS = t.s + dot + 1;
        const target = await resolvePath(obj, path);
        if (target && st.fields[target]) {
          for (const f of st.fields[target]) if (!frag || f.name.toLowerCase().startsWith(frag)) items.push({ v: f.name, m: f.type + " · " + f.label, s: insS, e: t.end });
          for (const f of st.fields[target]) if (f.relationshipName && (!frag || f.relationshipName.toLowerCase().startsWith(frag))) items.push({ v: f.relationshipName, m: "ref · " + (f.referenceTo[0] || ""), s: insS, e: t.end });
        }
      } else {
        const q2 = q.toLowerCase(); const fields = st.fields[obj] || [];
        for (const f of fields) if (!q2 || f.name.toLowerCase().startsWith(q2)) items.push({ v: f.name, m: f.type + " · " + f.label, s: t.s, e: t.end });
        for (const f of fields) if (f.relationshipName && (!q2 || f.relationshipName.toLowerCase().startsWith(q2))) items.push({ v: f.relationshipName, m: "ref · " + (f.referenceTo[0] || ""), s: t.s, e: t.end });
        for (const kw of SOQL_KEYWORDS) if (q2 && kw.toLowerCase().startsWith(q2)) items.push({ v: kw, m: "Keyword", s: t.s, e: t.end });
      }
    } else {
      const q = t.q.toLowerCase();
      for (const kw of SOQL_KEYWORDS) if (!q || kw.toLowerCase().startsWith(q)) items.push({ v: kw, m: "Keyword", s: t.s, e: t.end });
    }
    items = items.slice(0, 80);
    box.innerHTML = items.map((x, i) => `<button class="insp-sitem ${i === 0 ? "active" : ""}" data-v="${esc(x.v)}" data-s="${x.s}" data-e="${x.e}"><span>${esc(x.v)}</span><small>${esc(x.m)}</small></button>`).join("");
    box.classList.toggle("open", !!items.length);
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => { const e = $("sxQuery"); const v = b.dataset.v; const s = +b.dataset.s; const en = +b.dataset.e; e.value = e.value.slice(0, s) + v + e.value.slice(en); e.focus(); const caret = s + v.length; e.setSelectionRange(caret, caret); suggest(); }));
  }

  function formatQuery() { let q = $("sxQuery").value.replace(/\s+/g, " ").trim(); q = q.replace(/\b(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET)\b/gi, "\n$1"); $("sxQuery").value = q; }
  function idCell(id) { return `<span class="insp-idhover"><a class="insp-idlink">${esc(id)}</a><span class="insp-idactions"><button data-show="${id}">🔎 Show all data</button><button data-query="${id}">📋 Query record</button><button data-view="${id}">☁ View in Salesforce</button><button data-copy="${id}">▣ Copy Id</button><button data-edit="${id}">✎ Edit</button></span></span>`; }
  function renderResult() {
    const rows = st.filtered.map((r) => flattenRow(r, "", {})); const k = keys(rows);
    $("sxResult").innerHTML = rows.length ? `<table class="insp-table"><thead><tr><th><input id="sxAllRows" type="checkbox"></th>${k.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr><td><input class="sxRowSel" data-i="${i}" type="checkbox"></td>${k.map((x) => { let v = r[x]; return `<td>${ID.test(String(v || "")) ? idCell(v) : esc(v)}</td>`; }).join("")}</tr>`).join("")}</tbody></table>` : `<div class="empty-state" style="padding:22px">No records.</div>`;
    bindIds();
    const all = $("sxAllRows"); if (all) all.addEventListener("change", (e) => ov.body.querySelectorAll(".sxRowSel").forEach((x) => (x.checked = e.target.checked)));
  }
  function bindIds() {
    ov.body.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => openShowAllData(app, { recordId: b.dataset.show })));
    ov.body.querySelectorAll("[data-query]").forEach((b) => (b.onclick = () => { $("sxQuery").value = `SELECT FIELDS(ALL) FROM ${fromObj() || "Account"} WHERE Id = '${b.dataset.query}' LIMIT 1`; }));
    ov.body.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => window.open(`${api.instanceUrl}/lightning/r/${b.dataset.view}/view`, "_blank")));
    ov.body.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy)));
    ov.body.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openShowAllData(app, { recordId: b.dataset.edit })));
  }
  async function runQuery() {
    $("sxErr").classList.add("insp-hide");
    try { const d = await (($("sxAll").checked) ? api.queryAll($("sxQuery").value) : api.query($("sxQuery").value)); st.queryRows = d.records || []; st.filtered = st.queryRows; $("sxCount").textContent = `${st.queryRows.length} rows`; renderResult(); saveHistory($("sxQuery").value); }
    catch (e) { $("sxErr").textContent = e.message; $("sxErr").classList.remove("insp-hide"); }
  }
  function saveHistory(q) { let h = JSON.parse(localStorage.getItem("soqlHistory") || "[]").filter((x) => x !== q); h.unshift(q); localStorage.setItem("soqlHistory", JSON.stringify(h.slice(0, 30))); renderHistory(); }
  function renderHistory() { const h = JSON.parse(localStorage.getItem("soqlHistory") || "[]"); const f = JSON.parse(localStorage.getItem("soqlFavorites") || "[]"); $("sxHistory").innerHTML = '<option value="">History</option>' + h.map((x) => `<option>${esc(x)}</option>`).join(""); $("sxFav").innerHTML = '<option value="">Favorites</option>' + f.map((x) => `<option>${esc(x)}</option>`).join(""); }
  const flatAll = () => st.queryRows.map((r) => flattenRow(r, "", {}));
  $("sxQuery").addEventListener("input", suggest); $("sxQuery").addEventListener("focus", suggest);
  $("sxQuery").addEventListener("blur", () => setTimeout(() => $("sxSuggest").classList.remove("open"), 180));
  $("sxRun").onclick = runQuery; $("sxFormat").onclick = formatQuery; $("sxDownloadQuery").onclick = () => download("query.soql", $("sxQuery").value);
  $("sxCopyExcel").onclick = () => navigator.clipboard.writeText(tsvRows(flatAll()));
  $("sxCopyCsv").onclick = () => navigator.clipboard.writeText(csvRows(flatAll()));
  $("sxCopyJson").onclick = () => navigator.clipboard.writeText(JSON.stringify(st.queryRows, null, 2));
  $("sxDownload").onclick = () => download("salesforce-export.csv", csvRows(flatAll()), "text/csv");
  $("sxFilter").oninput = (e) => { const q = e.target.value.toLowerCase(); st.filtered = st.queryRows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)); renderResult(); };
  $("sxHistory").onchange = (e) => { if (e.target.value) $("sxQuery").value = e.target.value; };
  $("sxFav").onchange = $("sxHistory").onchange;
  $("sxFavorite").onclick = () => { const a = JSON.parse(localStorage.getItem("soqlFavorites") || "[]"); const q = $("sxQuery").value; if (!a.includes(q)) a.unshift(q); localStorage.setItem("soqlFavorites", JSON.stringify(a.slice(0, 30))); renderHistory(); };
  $("sxDelete").onclick = async () => { const sel = [...ov.body.querySelectorAll(".sxRowSel:checked")].map((x) => st.filtered[+x.dataset.i]).filter(Boolean); const obj = fromObj(); if (!sel.length || !obj) return alert("Select rows first."); if (!(app.settings && app.settings.confirmDeleteRecords === false) && !confirm(`Delete ${sel.length} ${obj} record(s)? This cannot be undone.`)) return; const d = await api.bulkAction({ objectName: obj, records: sel, operation: "delete" }); alert(`${d.succeeded} deleted, ${d.failed} failed`); runQuery(); };
  renderHistory(); loadObjects();
}

/* ============================================================ DATA IMPORT */
export function openDataImport(app) {
  const api = sf(app);
  const ov = openOverlay("Data Import", "importData");
  ov.conn.textContent = api.instanceUrl ? `Connected · ${new URL(api.instanceUrl).hostname}` : "";
  const st = { objects: [], fields: {}, rows: [], headers: [], map: {}, jobs: [], cancel: false };
  ov.body.innerHTML = `
    <div class="insp-grid2">
      <div class="insp-card">
        <div class="insp-sectitle">${Icons.gear} Configure Import</div>
        <div class="insp-row" style="margin-bottom:8px"><span class="insp-label" style="width:110px">API Type</span><select class="insp-select" id="diApi" style="flex:1"><option value="composite">REST Composite (default)</option><option value="enterprise">Enterprise</option></select></div>
        <div class="insp-row" style="margin-bottom:8px"><span class="insp-label" style="width:110px">Action</span><select class="insp-select" id="diAction" style="flex:1"><option value="insert">Insert</option><option value="update">Update</option><option value="upsert">Upsert</option><option value="delete">Delete</option><option value="undelete">Undelete</option></select></div>
        <div class="insp-row" style="margin-bottom:8px"><span class="insp-label" style="width:110px">Object</span><input class="insp-input" id="diObject" list="diObjList" placeholder="e.g. Account" style="flex:1"><datalist id="diObjList"></datalist></div>
        <div class="insp-row" style="margin-bottom:8px"><span class="insp-label" style="width:110px">External ID</span><select class="insp-select" id="diExternalId" style="flex:1"><option value="">Select for Upsert</option></select></div>
        <div class="insp-row" style="margin-bottom:8px"><span class="insp-label" style="width:110px">Format</span>
          <label class="insp-label"><input type="radio" name="diFmt" value="excel" checked> Excel</label>
          <label class="insp-label"><input type="radio" name="diFmt" value="csv"> CSV</label>
          <label class="insp-label"><input type="radio" name="diFmt" value="json"> JSON</label>
        </div>
        <div class="insp-row" style="margin-bottom:8px"><span class="insp-label" style="width:110px">Batch size</span><input class="insp-input" id="diBatch" type="number" value="200" style="width:90px"><span class="insp-label">Threads</span><input class="insp-input" id="diThreads" type="number" value="4" style="width:70px"></div>
        <label class="insp-label" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="diSkip"> Skip unknown fields</label>
        <div style="margin-top:8px"><textarea class="insp-textarea" id="diPaste" style="min-height:110px" placeholder="Paste Excel (tab), CSV, or JSON rows here…"></textarea></div>
      </div>
      <div class="insp-card">
        <div class="insp-sectitle">${Icons.tableData} Field Mapping</div>
        <div id="diMapping" class="empty-state" style="padding:16px">Paste data and select an object to prepare mappings.</div>
      </div>
    </div>
    <div class="insp-card">
      <div class="insp-row" style="margin-bottom:8px">
        <button class="btn primary sm" id="diRun">${Icons.play} Run Import</button>
        <button class="btn ghost sm" id="diCancel">Cancel Queued</button>
        <button class="btn ghost sm" id="diRetry">Retry Failed</button>
        <button class="btn ghost sm" id="diCopyExcel">Copy Excel</button>
        <button class="btn ghost sm" id="diCopyCsv">Copy CSV</button>
        <button class="btn ghost sm" id="diCopyOptions">Copy Options</button>
        <span class="spacer" style="flex:1"></span>
        <span class="insp-status">
          <span class="insp-badge"><span class="insp-dot q"></span><b id="diQ">0</b> Queued</span>
          <span class="insp-badge"><span class="insp-dot pr"></span><b id="diP">0</b> Processing</span>
          <span class="insp-badge"><span class="insp-dot ok"></span><b id="diS">0</b> Succeeded</span>
          <span class="insp-badge"><span class="insp-dot bad"></span><b id="diF">0</b> Failed</span>
        </span>
      </div>
      <div class="insp-progress" style="margin-bottom:8px"><span id="diBar"></span></div>
      <div class="insp-tablewrap" id="diResult"><div class="empty-state" style="padding:18px">Paste data to preview.</div></div>
    </div>`;
  const $ = (id) => ov.body.querySelector("#" + id);
  const fmt = () => (ov.body.querySelector('input[name="diFmt"]:checked') || {}).value || "excel";
  async function loadObjects() { try { const d = await api.objects(); st.objects = (d.sobjects || []).filter((o) => o.createable || o.triggerable).map((o) => o.name).sort(); $("diObjList").innerHTML = st.objects.map((s) => `<option value="${esc(s)}">`).join(""); } catch { } }
  async function ensureFields(obj) { if (!obj || st.fields[obj]) return; const d = await api.describe(obj); st.fields[obj] = (d.fields || []).map((f) => ({ name: f.name, label: f.label, type: f.type, externalId: f.externalId })); }
  function parseData(t, f) { t = t.trim(); if (!t) return []; if (f === "json") return JSON.parse(t); const delim = f === "csv" ? "," : "\t"; const lines = t.split(/\r?\n/); const h = lines[0].split(delim).map((x) => x.trim()); return lines.slice(1).map((l) => l.split(delim)).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] || "").trim()]))); }
  async function prepare() {
    st.rows = parseData($("diPaste").value, fmt()); st.headers = keys(st.rows);
    if ($("diAction").value === "update" && !$("diObject").value) { const id = st.rows[0] && st.rows[0].Id; if (id) { try { $("diObject").value = await api.resolveObjectFromId(id); } catch { } } }
    await loadImportFields(); renderMapping(); renderImport(st.rows); counts(st.rows.length, 0, 0, 0);
  }
  async function loadImportFields() { const obj = $("diObject").value; if (!obj) return; await ensureFields(obj); const ext = (st.fields[obj] || []).filter((f) => f.externalId); $("diExternalId").innerHTML = '<option value="">Select for Upsert</option>' + ext.map((f) => `<option value="${f.name}">${f.name} - ${f.label}</option>`).join(""); }
  function renderMapping() { const fields = st.fields[$("diObject").value] || []; $("diMapping").className = ""; $("diMapping").innerHTML = st.headers.length ? st.headers.map((h) => { const match = fields.find((f) => f.name.toLowerCase() === h.toLowerCase() || (f.label || "").toLowerCase() === h.toLowerCase()); st.map[h] = (match && match.name) || ""; return `<div class="insp-maprow"><b>${esc(h)}</b><select class="insp-select" data-map="${esc(h)}"><option value="">Ignore</option>${fields.map((f) => `<option value="${f.name}" ${f.name === st.map[h] ? "selected" : ""}>${f.name} · ${f.label}</option>`).join("")}</select></div>`; }).join("") : `<div class="empty-state" style="padding:16px">Paste data and select an object to prepare mappings.</div>`; ov.body.querySelectorAll("[data-map]").forEach((s) => (s.onchange = () => (st.map[s.dataset.map] = s.value))); }
  function mapped(rows) { return rows.map((r) => Object.fromEntries(Object.entries(st.map).filter(([, d]) => d).map(([s, d]) => [d, r[s]]))); }
  function renderImport(rows) { const k = keys(rows); $("diResult").innerHTML = rows.length ? `<table class="insp-table"><thead><tr>${k.map((x) => `<th>${esc(x)}</th>`).join("")}<th>Status</th></tr></thead><tbody>${rows.slice(0, 200).map((r, i) => `<tr>${k.map((x) => `<td>${esc(r[x])}</td>`).join("")}<td>${(st.jobs[i] && st.jobs[i].status) || "Queued"}</td></tr>`).join("")}</tbody></table>` : `<div class="empty-state" style="padding:18px">Paste data to preview.</div>`; }
  function counts(q, p, s, f) { $("diQ").textContent = q; $("diP").textContent = p; $("diS").textContent = s; $("diF").textContent = f; }
  async function runImport(rows = st.rows) {
    st.cancel = false; const data = mapped(rows); const total = data.length; let done = 0, success = 0, failed = 0;
    const action = $("diAction").value, obj = $("diObject").value; const batch = Math.min(200, Math.max(1, +$("diBatch").value || 200)); const threads = Math.min(10, Math.max(1, +$("diThreads").value || 4));
    if (!obj || !total) return alert("Choose object and paste data.");
    st.jobs = data.map((_, i) => ({ i, status: "Queued" })); counts(total, 0, 0, 0); let cursor = 0;
    async function worker() {
      while (cursor < total && !st.cancel) {
        const start = cursor; cursor += batch; const part = data.slice(start, start + batch);
        part.forEach((_, j) => (st.jobs[start + j].status = "Processing")); counts(total - done - part.length, part.length, success, failed);
        try { const r = await api.bulkAction({ objectName: obj, records: part, operation: action, externalIdField: $("diExternalId").value, allOrNone: false }); success += r.succeeded; failed += r.failed; (r.results || []).forEach((x, j) => (st.jobs[start + j] = { i: start + j, status: x.success ? "Succeeded" : "Failed", error: (x.errors && x.errors[0] && x.errors[0].message) || "" })); }
        catch (e) { failed += part.length; part.forEach((_, j) => (st.jobs[start + j] = { i: start + j, status: "Failed", error: e.message })); }
        done += part.length; $("diBar").style.width = Math.round((done / total) * 100) + "%"; counts(total - done, 0, success, failed); renderImport(rows);
      }
    }
    await Promise.all(Array.from({ length: threads }, worker));
  }
  $("diPaste").addEventListener("paste", () => setTimeout(prepare, 0));
  $("diPaste").addEventListener("input", () => setTimeout(prepare, 200));
  $("diObject").onchange = prepare; $("diAction").onchange = prepare;
  ov.body.querySelectorAll('input[name="diFmt"]').forEach((r) => (r.onchange = prepare));
  $("diRun").onclick = () => runImport(); $("diCancel").onclick = () => (st.cancel = true);
  $("diRetry").onclick = () => { const failed = st.jobs.filter((x) => x.status === "Failed").map((x) => st.rows[x.i]); runImport(failed); };
  $("diCopyExcel").onclick = () => navigator.clipboard.writeText(tsvRows(mapped(st.rows)));
  $("diCopyCsv").onclick = () => navigator.clipboard.writeText(csvRows(mapped(st.rows)));
  $("diCopyOptions").onclick = () => navigator.clipboard.writeText(JSON.stringify({ action: $("diAction").value, object: $("diObject").value, batch: +$("diBatch").value, threads: +$("diThreads").value, map: st.map }, null, 2));
  loadObjects();
}

/* ============================================================ SHOW ALL DATA */
export function openShowAllData(app, { recordId, objectName = "" } = {}) {
  const api = sf(app);
  const ov = openOverlay("Show All Data", "tableData");
  const state = { rows: [], meta: {}, changed: {}, editing: {} };
  ov.body.innerHTML = `
    <div class="insp-card">
      <div class="insp-row" style="margin-bottom:8px">
        <span class="insp-sectitle" id="sadTitle" style="margin:0">Loading record…</span>
        <span class="spacer" style="flex:1"></span>
        <input class="insp-input" id="sadFilter" placeholder="Filter fields…" style="min-width:200px">
        <button class="btn primary sm" id="sadSave">Save Changes</button>
        <button class="btn danger sm" id="sadDelete">Delete</button>
        <button class="btn ghost sm" id="sadCopy">Copy Excel</button>
        <button class="btn ghost sm" id="sadRefresh">Refresh</button>
        <span class="insp-label" id="sadMeta"></span>
      </div>
      <div class="insp-error insp-hide" id="sadOut"></div>
      <div class="insp-tablewrap" id="sadRecord" style="max-height:64vh"></div>
      <div class="insp-label" style="margin-top:6px">Read-only by default. Double-click an editable value to edit.</div>
    </div>`;
  const $ = (id) => ov.body.querySelector("#" + id);
  const val = (r) => (state.changed[r.field] !== undefined ? state.changed[r.field] : (r.value ?? ""));
  function idValue(v) { return `<span class="insp-idhover"><a class="insp-idlink">${esc(v)}</a><span class="insp-idactions"><button data-show="${v}">🔎 Show all data</button><button data-view="${v}">☁ View in Salesforce</button><button data-copy="${v}">▣ Copy Id</button></span></span>`; }
  function display(r) { const v = val(r); if (v === null || v === undefined || v === "") return '<span class="muted">(blank)</span>'; if (ID.test(String(v))) return idValue(v); return esc(typeof v === "object" ? JSON.stringify(v) : v); }
  function editor(r) { const v = val(r); if (r.type === "picklist") { const o = (r.picklistValues || []).filter((x) => x.active).map((x) => `<option ${String(v) === x.value ? "selected" : ""} value="${esc(x.value)}">${esc(x.label || x.value)}</option>`).join(""); return `<select class="insp-select" data-edit="${r.field}"><option value=""></option>${o}</select>`; } if (r.type === "boolean") return `<input type="checkbox" data-edit="${r.field}" ${v === true || v === "true" ? "checked" : ""}>`; return `<input class="insp-input" data-edit="${r.field}" value="${esc(v)}">`; }
  function bindIds() { ov.body.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => openShowAllData(app, { recordId: b.dataset.show }))); ov.body.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => window.open(`${state.meta.instanceUrl}/lightning/r/${b.dataset.view}/view`, "_blank"))); ov.body.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy))); }
  function render() {
    const f = ($("sadFilter").value || "").toLowerCase(); const view = state.rows.filter((r) => `${r.field} ${r.label} ${r.value}`.toLowerCase().includes(f));
    $("sadRecord").innerHTML = `<table class="insp-table"><thead><tr><th>Field API</th><th>Label</th><th>Type</th><th>Value</th></tr></thead><tbody>${view.map((r) => `<tr><td>${esc(r.field)} ${r.updateable ? "✎" : ""}</td><td>${esc(r.label)}</td><td>${esc(r.type)}</td><td class="${r.updateable ? "insp-editable" : ""}" data-field="${esc(r.field)}">${state.editing[r.field] ? editor(r) : display(r)}</td></tr>`).join("")}</tbody></table>`;
    ov.body.querySelectorAll(".insp-editable").forEach((c) => (c.ondblclick = () => { if (state.rows.find((x) => x.field === c.dataset.field && x.updateable)) { state.editing[c.dataset.field] = true; render(); } }));
    ov.body.querySelectorAll("[data-edit]").forEach((e) => (e.oninput = () => { state.changed[e.dataset.edit] = e.type === "checkbox" ? e.checked : e.value; $("sadMeta").textContent = `${Object.keys(state.changed).length} changed`; }));
    bindIds();
  }
  async function load() {
    try { state.changed = {}; state.editing = {}; const d = await api.recordDetails(objectName, recordId); state.meta = { objectName: d.objectName, recordId: d.recordId, instanceUrl: d.instanceUrl }; state.rows = (d.describe.fields || []).map((fld) => ({ field: fld.name, label: fld.label, type: fld.type, value: d.record[fld.name], updateable: fld.updateable, picklistValues: fld.picklistValues || [] })); $("sadTitle").textContent = `${d.objectName} · ${d.recordId}`; $("sadMeta").textContent = `${state.rows.length} fields`; render(); }
    catch (e) { show(e.message); }
  }
  function show(t) { $("sadOut").textContent = t; $("sadOut").classList.remove("insp-hide"); }
  async function save() { try { $("sadSave").textContent = "Saving…"; await api.updateRecord(state.meta.objectName, state.meta.recordId, state.changed); $("sadSave").textContent = "Saved ✓"; setTimeout(() => ($("sadSave").textContent = "Save Changes"), 1200); await load(); } catch (e) { $("sadSave").textContent = "Save Changes"; show(e.message); } }
  $("sadSave").onclick = save;
  $("sadDelete").onclick = async () => { if (confirm("Delete this record?")) { try { await api.deleteRecord(state.meta.objectName, state.meta.recordId); show("Record deleted."); } catch (e) { show(e.message); } } };
  $("sadCopy").onclick = () => navigator.clipboard.writeText("Field API\tLabel\tType\tValue\n" + state.rows.map((r) => [r.field, r.label, r.type, String(val(r)).replace(/\t|\r?\n/g, " ")].join("\t")).join("\n"));
  $("sadFilter").oninput = render; $("sadRefresh").onclick = load;
  load();
}

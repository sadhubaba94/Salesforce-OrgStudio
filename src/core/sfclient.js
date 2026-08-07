import { API_VERSION } from "../common/constants.js";
import { refreshToken, isTokenStale } from "./auth.js";
import * as store from "./storage.js";
export class SFClient {
  constructor(org) { this.org = org; this.apiVersion = org.apiVersion || API_VERSION; this.limitInfo = null; }
  static async forActiveOrg() { const o = await store.getActiveOrg(); if (!o) throw new Error("No org connected."); return new SFClient(o); }
  get instanceUrl() { return this.org.instanceUrl; }
  authHeader() { return `${this.org.tokenType || "Bearer"} ${this.org.accessToken}`; }
  async request(path, { method = "GET", body, headers = {}, raw = false, _retried = false } = {}) {
    if (!_retried && isTokenStale(this.org) && this.org.connMethod === "oauth") { try { this.org = await refreshToken(this.org.id); } catch (_) {} }
    const url = /^https?:\/\//.test(path) ? path : `${this.instanceUrl}${path}`;
    const res = await fetch(url, { method, headers: { Authorization: this.authHeader(), "Content-Type": "application/json", Accept: "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const limit = res.headers.get("Sforce-Limit-Info");
    if (limit) { const m = /api-usage=(\d+)\/(\d+)/.exec(limit); if (m) this.limitInfo = { used: +m[1], total: +m[2] }; }
    if (res.status === 401 && !_retried && this.org.connMethod === "oauth") { this.org = await refreshToken(this.org.id); return this.request(path, { method, body, headers, raw, _retried: true }); }
    if (raw) return res;
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
    if (!res.ok) throw shapeError(res.status, json, text);
    return json;
  }
  async query(soql, { tooling = false, all = false } = {}) {
    const seg = tooling ? `/services/data/v${this.apiVersion}/tooling` : `/services/data/v${this.apiVersion}`;
    let result = await this.request(`${seg}/query?q=${encodeURIComponent(soql)}`);
    const records = result.records || [];
    while (all && result.nextRecordsUrl) { result = await this.request(result.nextRecordsUrl); records.push(...(result.records || [])); }
    return { ...result, records };
  }
  toolingQuery(soql, opts = {}) { return this.query(soql, { ...opts, tooling: true }); }
  toolingCreate(o, f) { return this.request(`/services/data/v${this.apiVersion}/tooling/sobjects/${o}`, { method: "POST", body: f }); }
  toolingUpdate(o, id, f) { return this.request(`/services/data/v${this.apiVersion}/tooling/sobjects/${o}/${id}`, { method: "PATCH", body: f }); }
  toolingDelete(o, id) { return this.request(`/services/data/v${this.apiVersion}/tooling/sobjects/${o}/${id}`, { method: "DELETE" }); }
  toolingRetrieve(o, id, fields) { const f = fields ? `?fields=${encodeURIComponent(fields.join(","))}` : ""; return this.request(`/services/data/v${this.apiVersion}/tooling/sobjects/${o}/${id}${f}`); }
  restCreate(o, f) { return this.request(`/services/data/v${this.apiVersion}/sobjects/${o}`, { method: "POST", body: f }); }
  restRetrieve(o, id) { return this.request(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(o)}/${encodeURIComponent(id)}`); }
  restUpdate(o, id, f) { return this.request(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(o)}/${encodeURIComponent(id)}`, { method: "PATCH", body: f }); }
  restDelete(o, id) { return this.request(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(o)}/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  describeSObject(name) { return this.request(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(name)}/describe`); }
  async queryAll(soql, { tooling = false } = {}) { return this.query(soql, { tooling, all: true }); }
  compositeCreate(records, allOrNone = false) { return this.request(`/services/data/v${this.apiVersion}/composite/sobjects`, { method: "POST", body: { allOrNone, records } }); }
  compositeUpdate(records, allOrNone = false) { return this.request(`/services/data/v${this.apiVersion}/composite/sobjects`, { method: "PATCH", body: { allOrNone, records } }); }
  compositeDelete(ids, allOrNone = false) { return this.request(`/services/data/v${this.apiVersion}/composite/sobjects?ids=${encodeURIComponent(ids.join(","))}&allOrNone=${allOrNone}`, { method: "DELETE" }); }
  upsertByExternalId(o, field, value, body) { return this.request(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(o)}/${encodeURIComponent(field)}/${encodeURIComponent(value)}`, { method: "PATCH", body }); }
  undelete(id) { return this.request(`/services/data/v${this.apiVersion}/composite/sobjects?ids=${encodeURIComponent(id)}&allOrNone=true`, { method: "POST" }); }
  describeGlobal() { return this.request(`/services/data/v${this.apiVersion}/sobjects/`); }
  graphql(query, variables) { return this.request(`/services/data/v${this.apiVersion}/graphql`, { method: "POST", body: { query, variables: variables || {} } }); }
  executeAnonymous(apex) { return this.request(`/services/data/v${this.apiVersion}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(apex)}`); }
  limits() { return this.request(`/services/data/v${this.apiVersion}/limits`); }
  async metadataSoap(action, innerXml) {
    const endpoint = `${this.instanceUrl}/services/Soap/m/${this.apiVersion}`;
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata"><soapenv:Header><met:SessionHeader><met:sessionId>${this.org.accessToken}</met:sessionId></met:SessionHeader></soapenv:Header><soapenv:Body>${innerXml}</soapenv:Body></soapenv:Envelope>`;
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' }, body: envelope });
    const xml = await res.text();
    if (!res.ok) throw new Error(`Metadata API ${action} failed (${res.status}): ${(/<faultstring>([\s\S]*?)<\/faultstring>/.exec(xml) || [])[1] || xml.slice(0,200)}`);
    return xml;
  }
}
function shapeError(status, json, text) {
  let msg = text || `HTTP ${status}`, code = String(status);
  if (Array.isArray(json) && json[0]) { code = json[0].errorCode || code; msg = json[0].message || msg; }
  else if (json && json.error) { code = json.error; msg = json.error_description || msg; }
  else if (json && json.message) { msg = json.message; }
  const err = new Error(`[${code}] ${msg}`); err.status = status; err.code = code; err.body = json; return err;
}

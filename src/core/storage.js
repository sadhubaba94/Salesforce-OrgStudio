import { STORAGE_KEYS } from "../common/constants.js";
import { uid } from "../common/util.js";
const S = browser.storage.local;
async function get(key, fb) { const r = await S.get(key); return r[key] === undefined ? fb : r[key]; }
async function set(key, value) { await S.set({ [key]: value }); return value; }
export async function getOrgs() { return get(STORAGE_KEYS.ORGS, {}); }
export async function getOrg(id) { return (await getOrgs())[id] || null; }
export async function saveOrg(org) { const orgs = await getOrgs(); if (!org.id) org.id = org.orgId || uid(); orgs[org.id] = { ...(orgs[org.id] || {}), ...org }; await set(STORAGE_KEYS.ORGS, orgs); if (!(await getActiveOrgId())) await setActiveOrgId(org.id); return orgs[org.id]; }
export async function removeOrg(id) { const orgs = await getOrgs(); delete orgs[id]; await set(STORAGE_KEYS.ORGS, orgs); if ((await getActiveOrgId()) === id) await setActiveOrgId(Object.keys(orgs)[0] || null); }
export async function getActiveOrgId() { return get(STORAGE_KEYS.ACTIVE_ORG, null); }
export async function setActiveOrgId(id) { return set(STORAGE_KEYS.ACTIVE_ORG, id); }
export async function getActiveOrg() { const id = await getActiveOrgId(); return id ? getOrg(id) : null; }
export async function updateTokens(id, tokens) { const orgs = await getOrgs(); if (!orgs[id]) return null; orgs[id] = { ...orgs[id], ...tokens }; await set(STORAGE_KEYS.ORGS, orgs); return orgs[id]; }
export const DEFAULT_SETTINGS = { theme: "light", fontSize: 13, fontFamily: "", tabSize: 4, wordWrap: false, autoCloseBrackets: true, highlightActiveLine: true, confirmProdDeploy: true, apiVersion: "", autosaveDrafts: true, panelCollapsed: false, lineHeight: 1.6, showLineNumbers: true, confirmDeleteRecords: true, githubAutoPush: false, defaultQueryAll: false };
export async function getSettings() { return { ...DEFAULT_SETTINGS, ...(await get(STORAGE_KEYS.SETTINGS, {})) }; }
export async function saveSettings(patch) { const m = { ...(await getSettings()), ...patch }; return set(STORAGE_KEYS.SETTINGS, m); }
export async function resetSettings() { await set(STORAGE_KEYS.SETTINGS, {}); return { ...DEFAULT_SETTINGS }; }
export async function getClientId() { return get(STORAGE_KEYS.CLIENT_ID, ""); }
export async function setClientId(id) { return set(STORAGE_KEYS.CLIENT_ID, (id || "").trim()); }
export const DEFAULT_GITHUB = { token: "", owner: "", repo: "", branch: "main", basePath: "force-app/main/default", user: null, connectedAt: null };
export async function getGithub() { return { ...DEFAULT_GITHUB, ...(await get(STORAGE_KEYS.GITHUB, {})) }; }
export async function saveGithub(patch) { const m = { ...(await getGithub()), ...patch }; return set(STORAGE_KEYS.GITHUB, m); }
export async function clearGithub() { await set(STORAGE_KEYS.GITHUB, {}); return { ...DEFAULT_GITHUB }; }
export async function getOpenTabs(orgId) { return (await get(STORAGE_KEYS.OPEN_TABS, {}))[orgId] || []; }
export async function saveOpenTabs(orgId, tabs) { const a = await get(STORAGE_KEYS.OPEN_TABS, {}); a[orgId] = tabs; return set(STORAGE_KEYS.OPEN_TABS, a); }
export async function getRecent(orgId) { return (await get(STORAGE_KEYS.RECENT, {}))[orgId] || []; }
export async function pushRecent(orgId, entry) { const a = await get(STORAGE_KEYS.RECENT, {}); const list = (a[orgId] || []).filter((e) => e.key !== entry.key); list.unshift({ ...entry, at: new Date().toISOString() }); a[orgId] = list.slice(0, 25); return set(STORAGE_KEYS.RECENT, a); }
export async function saveSnapshot(orgId, fileKey, name, content) { const a = await get(STORAGE_KEYS.SNAPSHOTS, {}); const key = `${orgId}::${fileKey}`; const list = a[key] || []; list.unshift({ id: uid(), name, content, at: new Date().toISOString() }); a[key] = list.slice(0, 20); await set(STORAGE_KEYS.SNAPSHOTS, a); return a[key]; }
export async function getSnapshots(orgId, fileKey) { return (await get(STORAGE_KEYS.SNAPSHOTS, {}))[`${orgId}::${fileKey}`] || []; }
export async function stashPkce(state, data) { const a = await get(STORAGE_KEYS.PKCE, {}); a[state] = { ...data, at: Date.now() }; return set(STORAGE_KEYS.PKCE, a); }
export async function takePkce(state) { const a = await get(STORAGE_KEYS.PKCE, {}); const d = a[state]; delete a[state]; await set(STORAGE_KEYS.PKCE, a); return d || null; }

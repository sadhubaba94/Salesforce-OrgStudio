import "../vendor/browser-polyfill.js";
import { MSG } from "../common/constants.js";
import { openIde } from "../common/env.js";
import * as store from "../core/storage.js";
import { refreshToken, isTokenStale, connectViaSession } from "../core/auth.js";
const REFRESH_ALARM = "orgstudio:refresh";
export function initBackground() {
  if (browser.action && browser.action.onClicked) browser.action.onClicked.addListener(() => openIde());
  if (browser.alarms) { browser.alarms.create(REFRESH_ALARM, { periodInMinutes: 15 }); browser.alarms.onAlarm.addListener((a) => { if (a.name === REFRESH_ALARM) sweepRefresh().catch(console.warn); }); }
  browser.runtime.onInstalled.addListener(() => console.info("[OrgStudio] installed / updated."));
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => { handleMessage(msg, sender).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message })); return true; });
}
async function handleMessage(msg) {
  switch (msg && msg.type) {
    case MSG.OPEN_IDE: await openIde(); return { ok: true };
    case MSG.REFRESH_TOKEN: return { ok: true, org: await refreshToken(msg.orgId) };
    case MSG.READ_SESSION: return { ok: true, ...(await readSessionFromActiveTab()) };
    case MSG.CONNECT_ACTIVE: { const { instanceUrl, sessionId } = await readSessionFromActiveTab(); const org = await connectViaSession({ instanceUrl, sessionId }); return { ok: true, org }; }
    default: return { ok: false, error: `Unknown message: ${msg && msg.type}` };
  }
}
async function sweepRefresh() { const orgs = await store.getOrgs(); for (const org of Object.values(orgs)) { if (org.connMethod === "oauth" && isTokenStale(org)) { try { await refreshToken(org.id); } catch (e) { console.warn("refresh failed", org.username, e.message); } } } }
async function readSessionFromActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  let tab = tabs[0];
  const isSf = (u) => u && /https:\/\/[^/]+\.(my\.salesforce\.com|salesforce\.com|lightning\.force\.com|force\.com|visualforce\.com)\b/.test(u);
  if (!tab || !isSf(tab.url)) { const all = await browser.tabs.query({}); tab = all.find((t) => isSf(t.url)); }
  if (!tab || !tab.url) throw new Error("No open Salesforce org tab found. Log into your org in another tab, then try again.");
  const url = new URL(tab.url);
  let instanceHost = url.hostname.replace(".lightning.force.com", ".my.salesforce.com").replace(/\.vf\.force\.com$/, ".my.salesforce.com").replace(/\.visualforce\.com$/, ".my.salesforce.com");
  let sid = null;
  if (browser.cookies) {
    for (const host of [instanceHost, url.hostname]) { const c = await browser.cookies.get({ url: `https://${host}`, name: "sid" }).catch(() => null); if (c && c.value) { sid = c.value; instanceHost = host.includes(".my.salesforce.com") ? host : instanceHost; break; } }
    if (!sid) { const all = await browser.cookies.getAll({ name: "sid" }).catch(() => []); const best = all.find((c) => /\.my\.salesforce\.com$/.test(c.domain)) || all[0]; if (best) { sid = best.value; instanceHost = best.domain.replace(/^\./, ""); } }
  }
  if (!sid) throw new Error("Could not read the org session. Make sure you are logged into Salesforce and the extension has cookie access.");
  return { instanceUrl: `https://${instanceHost}`, sessionId: sid };
}

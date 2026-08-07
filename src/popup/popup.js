import "../vendor/browser-polyfill.js";
import { engineLabel, openIde } from "../common/env.js";
import { MSG } from "../common/constants.js";
import * as store from "../core/storage.js";
import { brandSvg, Icons } from "../ide/icons.js";
const $ = (s) => document.querySelector(s);
async function init() {
  const settings = await store.getSettings();
  document.documentElement.setAttribute("data-theme", settings.theme || "light");
  $("#popMark").innerHTML = brandSvg(24);
  $("#popTheme").innerHTML = settings.theme === "dark" ? Icons.sun : Icons.moon;
  $("#popFoot").textContent = engineLabel();
  await renderOrgs(); await detectActiveOrg();
  $("#quickConnect").onclick = quickConnect;
  $("#openIde").onclick = () => { openIde(); window.close(); };
  $("#popTheme").onclick = async () => { const s = await store.getSettings(); const next = s.theme === "dark" ? "light" : "dark"; await store.saveSettings({ theme: next }); document.documentElement.setAttribute("data-theme", next); $("#popTheme").innerHTML = next === "dark" ? Icons.sun : Icons.moon; };
}
async function detectActiveOrg() {
  try { const isSf = (u) => u && /https:\/\/[^/]+\.(my\.salesforce\.com|salesforce\.com|lightning\.force\.com|force\.com|visualforce\.com)\b/.test(u); const tabs = await browser.tabs.query({}); const tab = tabs.find((t) => t.active && isSf(t.url)) || tabs.find((t) => isSf(t.url)); const box = $("#popDetect"); if (tab) { box.classList.add("show"); box.innerHTML = `Detected Salesforce tab: <b>${new URL(tab.url).hostname}</b>`; } else { box.classList.add("show"); box.innerHTML = `No Salesforce tab detected. Log into your org, then click <b>Connect</b>.`; } } catch (_) {}
}
async function quickConnect() {
  const btn = $("#quickConnect"); const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Connecting…`;
  try { const resp = await browser.runtime.sendMessage({ type: MSG.CONNECT_ACTIVE }); if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Could not connect."); await store.setActiveOrgId(resp.org.id); await openIde(); window.close(); }
  catch (e) { btn.disabled = false; btn.innerHTML = orig; const box = $("#popDetect"); box.classList.add("show"); box.innerHTML = `⚠️ ${e.message}`; }
}
async function renderOrgs() {
  const box = $("#popOrg"); const orgs = Object.values(await store.getOrgs()); const activeId = await store.getActiveOrgId();
  if (!orgs.length) { box.innerHTML = `<div class="pop-empty">No org connected yet.<br>Click “Connect to your open org”.</div>`; return; }
  box.innerHTML = "";
  orgs.forEach((o) => { const row = document.createElement("div"); row.className = "pop-org-row" + (o.id === activeId ? " active" : ""); row.innerHTML = `<span class="dot ${o.isSandbox ? "sandbox" : "prod"}"></span><div style="min-width:0"><div class="pop-u">${o.username}</div><div class="pop-i">${host(o.instanceUrl)}</div></div><span class="badge ${o.isSandbox ? "sandbox" : "prod"}">${o.isSandbox ? "SBX" : "PROD"}</span>`; row.onclick = async () => { await store.setActiveOrgId(o.id); openIde(); window.close(); }; box.appendChild(row); });
}
function host(u) { try { return new URL(u).hostname; } catch { return u; } }
init();

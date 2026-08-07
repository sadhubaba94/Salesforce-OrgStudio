/* browser-polyfill.js — promisify chrome.* -> browser.* (Firefox already has browser.*). */
(function (global) {
  "use strict";
  if (typeof global.browser === "object" && global.browser !== null && global.browser.runtime) return;
  const chrome = global.chrome;
  if (!chrome) { console.warn("[OrgStudio] No chrome namespace."); return; }
  function promisify(fn, ctx) { return function (...args) { return new Promise((resolve, reject) => { try { fn.call(ctx, ...args, (r) => { const e = chrome.runtime && chrome.runtime.lastError; if (e) reject(new Error(e.message)); else resolve(r); }); } catch (e) { reject(e); } }); }; }
  const browser = {};
  if (chrome.storage) { browser.storage = {}; for (const area of ["local", "sync", "session"]) { if (chrome.storage[area]) browser.storage[area] = { get: promisify(chrome.storage[area].get, chrome.storage[area]), set: promisify(chrome.storage[area].set, chrome.storage[area]), remove: promisify(chrome.storage[area].remove, chrome.storage[area]), clear: promisify(chrome.storage[area].clear, chrome.storage[area]) }; } browser.storage.onChanged = chrome.storage.onChanged; }
  if (chrome.runtime) browser.runtime = { id: chrome.runtime.id, getURL: chrome.runtime.getURL.bind(chrome.runtime), getManifest: chrome.runtime.getManifest.bind(chrome.runtime), sendMessage: promisify(chrome.runtime.sendMessage, chrome.runtime), onMessage: chrome.runtime.onMessage, onInstalled: chrome.runtime.onInstalled, onStartup: chrome.runtime.onStartup, get lastError() { return chrome.runtime.lastError; } };
  if (chrome.tabs) browser.tabs = { query: promisify(chrome.tabs.query, chrome.tabs), get: promisify(chrome.tabs.get, chrome.tabs), create: promisify(chrome.tabs.create, chrome.tabs), update: promisify(chrome.tabs.update, chrome.tabs), remove: promisify(chrome.tabs.remove, chrome.tabs), sendMessage: promisify(chrome.tabs.sendMessage, chrome.tabs) };
  if (chrome.identity) browser.identity = { getRedirectURL: chrome.identity.getRedirectURL ? chrome.identity.getRedirectURL.bind(chrome.identity) : () => `https://${chrome.runtime.id}.chromiumapp.org/`, launchWebAuthFlow: promisify(chrome.identity.launchWebAuthFlow, chrome.identity) };
  if (chrome.alarms) browser.alarms = { create: chrome.alarms.create.bind(chrome.alarms), clear: promisify(chrome.alarms.clear, chrome.alarms), clearAll: promisify(chrome.alarms.clearAll, chrome.alarms), get: promisify(chrome.alarms.get, chrome.alarms), getAll: promisify(chrome.alarms.getAll, chrome.alarms), onAlarm: chrome.alarms.onAlarm };
  if (chrome.cookies) browser.cookies = { get: promisify(chrome.cookies.get, chrome.cookies), getAll: promisify(chrome.cookies.getAll, chrome.cookies) };
  if (chrome.downloads) browser.downloads = { download: promisify(chrome.downloads.download, chrome.downloads) };
  if (chrome.action) browser.action = { onClicked: chrome.action.onClicked, setBadgeText: promisify(chrome.action.setBadgeText, chrome.action), setBadgeBackgroundColor: promisify(chrome.action.setBadgeBackgroundColor, chrome.action), setTitle: promisify(chrome.action.setTitle, chrome.action) };
  global.browser = browser;
})(typeof globalThis !== "undefined" ? globalThis : self);

export const IS_FIREFOX = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent || "");
export const IS_CHROME = !IS_FIREFOX;
export function getRedirectURL(path = "oauth") { return browser.identity.getRedirectURL(path); }
export function launchWebAuthFlow(authUrl, { interactive = true } = {}) { return browser.identity.launchWebAuthFlow({ url: authUrl, interactive }); }
export async function openIde() { const url = browser.runtime.getURL("src/ide/ide.html"); const tabs = await browser.tabs.query({}); const existing = tabs.find((t) => t.url && t.url.startsWith(url)); if (existing) return browser.tabs.update(existing.id, { active: true }); return browser.tabs.create({ url }); }
export function engineLabel() { const v = browser.runtime.getManifest().version; return `${IS_FIREFOX ? "Firefox" : "Chrome"} · v${v}`; }

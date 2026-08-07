import { API_VERSION, OAUTH_SCOPES, LOGIN_ENDPOINTS, TOKEN_REFRESH_SKEW_SEC } from "../common/constants.js";
import { randomString, sha256Base64Url, parseParams, formEncode } from "../common/util.js";
import { getRedirectURL, launchWebAuthFlow } from "../common/env.js";
import * as store from "./storage.js";
export async function loginOAuth({ envType, myDomain, clientId }) {
  if (!clientId) throw new Error("Missing Connected App Consumer Key.");
  const loginBase = resolveLoginBase(envType, myDomain);
  const redirectUri = getRedirectURL("oauth");
  const codeVerifier = randomString(48); const codeChallenge = await sha256Base64Url(codeVerifier); const state = randomString(16);
  await store.stashPkce(state, { codeVerifier });
  const authUrl = `${loginBase}/services/oauth2/authorize?` + formEncode({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: OAUTH_SCOPES.join(" "), state, code_challenge: codeChallenge, code_challenge_method: "S256", prompt: "login" });
  const redirected = await launchWebAuthFlow(authUrl, { interactive: true });
  const returned = parseParams(new URL(redirected).search);
  if (returned.error) throw new Error(`OAuth error: ${returned.error} — ${returned.error_description || ""}`);
  if (returned.state !== state) throw new Error("OAuth state mismatch (possible CSRF).");
  const pkce = await store.takePkce(state);
  const token = await exchangeCodeForToken({ loginBase, clientId, redirectUri, code: returned.code, codeVerifier: pkce.codeVerifier });
  return store.saveOrg(await buildOrgRecord(token, { connMethod: "oauth", clientId, loginBase }));
}
async function exchangeCodeForToken({ loginBase, clientId, redirectUri, code, codeVerifier }) {
  const res = await fetch(`${loginBase}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formEncode({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: codeVerifier }) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error} — ${data.error_description || ""}`);
  return data;
}
export async function refreshToken(orgId) {
  const org = await store.getOrg(orgId);
  if (!org) throw new Error("Org not found.");
  if (org.connMethod === "session") throw new Error("Session connection cannot be refreshed. Re-connect from the org tab.");
  if (!org.refreshToken) throw new Error("No refresh token; please re-authenticate.");
  const res = await fetch(`${org.loginUrl}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formEncode({ grant_type: "refresh_token", refresh_token: org.refreshToken, client_id: org.clientId }) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Refresh failed: ${data.error} — ${data.error_description || ""}`);
  const issuedAt = Number(data.issued_at) || Date.now();
  return store.updateTokens(orgId, { accessToken: data.access_token, tokenType: data.token_type || "Bearer", issuedAt, expiresAt: issuedAt + 2 * 3600 * 1000 });
}
export function isTokenStale(org) { if (!org || !org.expiresAt) return false; return Date.now() >= org.expiresAt - TOKEN_REFRESH_SKEW_SEC * 1000; }
export async function connectViaSession({ instanceUrl, sessionId }) { if (!instanceUrl || !sessionId) throw new Error("Missing instance URL or session id."); const token = { access_token: sessionId, instance_url: instanceUrl.replace(/\/+$/, ""), token_type: "Bearer", issued_at: Date.now() }; return store.saveOrg(await buildOrgRecord(token, { connMethod: "session", clientId: null, loginUrl: instanceUrl })); }
export async function disconnect(orgId, { revoke = true } = {}) { const org = await store.getOrg(orgId); if (org && revoke && org.connMethod === "oauth" && org.accessToken) { try { await fetch(`${org.loginUrl}/services/oauth2/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formEncode({ token: org.refreshToken || org.accessToken }) }); } catch (_) {} } await store.removeOrg(orgId); }
function resolveLoginBase(envType, myDomain) { if (envType === "custom" && myDomain) { let d = myDomain.trim(); if (!/^https?:\/\//i.test(d)) d = `https://${d}`; if (!/\./.test(new URL(d).hostname)) d = `https://${new URL(d).hostname}.my.salesforce.com`; return d.replace(/\/+$/, ""); } return envType === "sandbox" ? LOGIN_ENDPOINTS.sandbox : LOGIN_ENDPOINTS.production; }
async function buildOrgRecord(token, extra) {
  const instanceUrl = token.instance_url.replace(/\/+$/, "");
  const headers = { Authorization: `${token.token_type || "Bearer"} ${token.access_token}` };
  let identity = {};
  try { if (token.id) { const r = await fetch(token.id, { headers }); if (r.ok) identity = await r.json(); } } catch (_) {}
  let isSandbox = /test\.salesforce\.com|sandbox/i.test(extra.loginBase || extra.loginUrl || "");
  let orgType = "Unknown"; let username = identity.username || "";
  try { const r = await fetch(`${instanceUrl}/services/data/v${API_VERSION}/query?q=` + encodeURIComponent("SELECT IsSandbox, OrganizationType, Name FROM Organization LIMIT 1"), { headers }); if (r.ok) { const j = await r.json(); const rec = j.records && j.records[0]; if (rec) { isSandbox = rec.IsSandbox; orgType = rec.OrganizationType; } } } catch (_) {}
  if (!username) { try { const r = await fetch(`${instanceUrl}/services/data/v${API_VERSION}/chatter/users/me`, { headers }); if (r.ok) { const me = await r.json(); username = me.username || me.displayName || ""; identity.organization_id = identity.organization_id || me.companyName; } } catch (_) {} }
  const issuedAt = Number(token.issued_at) || Date.now();
  return { id: identity.organization_id || undefined, orgId: identity.organization_id || "", username: username || "(current session)", displayName: identity.display_name || username || instanceUrl, instanceUrl, loginUrl: extra.loginBase || extra.loginUrl || instanceUrl, isSandbox, orgType, apiVersion: API_VERSION, accessToken: token.access_token, refreshToken: token.refresh_token || null, tokenType: token.token_type || "Bearer", issuedAt, expiresAt: issuedAt + 2 * 3600 * 1000, connMethod: extra.connMethod, clientId: extra.clientId || null };
}

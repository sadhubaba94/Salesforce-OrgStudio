export function base64UrlEncode(bytes) { const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export function randomString(len = 48) { const b = new Uint8Array(len); crypto.getRandomValues(b); return base64UrlEncode(b); }
export async function sha256Base64Url(input) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return base64UrlEncode(new Uint8Array(d)); }
export function parseParams(str) { const o = {}; const q = str.replace(/^[?#]/, ""); for (const p of q.split("&")) { if (!p) continue; const [k, v = ""] = p.split("="); o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); } return o; }
export function formEncode(obj) { return Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, wait = 300) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), wait); }; }
export function timeAgo(iso) { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return `${s}s ago`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`; return new Date(iso).toLocaleDateString(); }
export function escapeHtml(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export function fmt(n) { return typeof n === "number" ? n.toLocaleString() : n; }
export function utf8ToBase64(str) { const b = new TextEncoder().encode(str); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }
export function bytesToBase64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }

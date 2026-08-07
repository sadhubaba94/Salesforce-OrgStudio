import { escapeHtml } from "../common/util.js";
import { Icons } from "./icons.js";
const $ = (s) => document.querySelector(s);
export const UI = {
  toast(title, msg = "", kind = "", ttl = 3500) {
    const wrap = $("#toasts"); const el = document.createElement("div"); el.className = "toast " + (kind || "");
    const icon = kind === "ok" ? Icons.check : kind === "err" ? Icons.alert : kind === "warn" ? Icons.alert : Icons.play;
    const col = kind === "ok" ? "success" : kind === "err" ? "danger" : kind === "warn" ? "warning" : "accent";
    el.innerHTML = `<span style="color:var(--${col});flex:none">${icon}</span><div><div class="t-title">${escapeHtml(title)}</div>${msg ? `<div class="t-msg">${escapeHtml(msg)}</div>` : ""}</div>`;
    wrap.appendChild(el); const kill = () => { el.style.opacity = "0"; el.style.transform = "translateX(16px)"; setTimeout(() => el.remove(), 200); }; el.onclick = kill; if (ttl) setTimeout(kill, ttl);
  },
  modal({ title, subtitle, bodyHtml, actions = [], onMount, wide = false }) {
    const backdrop = $("#modalBackdrop"); const modal = $("#modal");
    modal.className = "modal" + (wide ? " wide" : "");
    modal.innerHTML = `<div class="modal-head"><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div><div class="modal-body">${bodyHtml || ""}</div><div class="modal-foot"></div>`;
    const foot = modal.querySelector(".modal-foot");
    actions.forEach((a) => { const b = document.createElement("button"); b.className = "btn " + (a.kind || "ghost"); b.textContent = a.label; b.onclick = async () => { if (a.onClick) { const keep = await a.onClick(modal); if (keep === true) return; } if (!a.keepOpen) UI.closeModal(); }; foot.appendChild(b); });
    backdrop.hidden = false; backdrop.onclick = (e) => { if (e.target === backdrop) UI.closeModal(); }; if (onMount) onMount(modal); return modal;
  },
  closeModal() { $("#modalBackdrop").hidden = true; $("#modal").innerHTML = ""; },
  confirm(title, message) { return new Promise((resolve) => { UI.modal({ title, subtitle: message, actions: [ { label: "Cancel", kind: "ghost", onClick: () => resolve(false) }, { label: "Confirm", kind: "primary", onClick: () => resolve(true) } ] }); const bd = $("#modalBackdrop"); const obs = new MutationObserver(() => { if (bd.hidden) { resolve(false); obs.disconnect(); } }); obs.observe(bd, { attributes: true, attributeFilter: ["hidden"] }); }); },
  confirmProd(org) { return new Promise((resolve) => { let confirmed = false; UI.modal({ title: "Deploy to PRODUCTION?", subtitle: "You are about to modify metadata in a live production org.", bodyHtml: `<div class="danger-box"><b>${escapeHtml(org.username)}</b> — ${escapeHtml(org.orgType || "Production")}<br>Changes take effect immediately and can affect real users and data.</div><div class="field"><label>Type <b>DEPLOY</b> to confirm</label><input id="prodConfirm" placeholder="DEPLOY" autocomplete="off" /></div>`, actions: [ { label: "Cancel", kind: "ghost", onClick: () => resolve(false) }, { label: "Deploy to Production", kind: "danger", keepOpen: true, onClick: (root) => { if (root.querySelector("#prodConfirm").value.trim().toUpperCase() === "DEPLOY") { confirmed = true; UI.closeModal(); resolve(true); } else UI.toast("Type DEPLOY to confirm", "", "warn"); } } ], onMount: (root) => root.querySelector("#prodConfirm").focus() }); const bd = $("#modalBackdrop"); const obs = new MutationObserver(() => { if (bd.hidden) { if (!confirmed) resolve(false); obs.disconnect(); } }); obs.observe(bd, { attributes: true, attributeFilter: ["hidden"] }); }); },
  viewer(title, text) { UI.modal({ wide: true, title, bodyHtml: `<pre class="console" style="max-height:56vh;overflow:auto;background:var(--editor-bg);border:1px solid var(--border);border-radius:8px;padding:12px">${escapeHtml(text || "(empty)")}</pre>`, actions: [ { label: "Copy", kind: "ghost", keepOpen: true, onClick: () => { navigator.clipboard.writeText(text || ""); UI.toast("Copied", "", "ok"); } }, { label: "Close", kind: "primary" } ] }); },
};

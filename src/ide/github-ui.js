/* github-ui.js — GitHub sign-in + one-click pull/push UI for OrgStudio. */
import { GitHub, repoPathFor } from "../core/github.js";
import * as store from "../core/storage.js";
import { escapeHtml } from "../common/util.js";
import { Icons } from "./icons.js";

let CTX = null;
export function initGithub(ctx) { CTX = ctx; }

export async function githubBadge() {
  const cfg = await store.getGithub();
  const btn = document.querySelector("#githubBtn");
  if (!btn) return;
  const connected = !!(cfg.token && cfg.owner && cfg.repo);
  btn.classList.toggle("gh-on", connected);
  btn.title = connected ? `GitHub · ${cfg.owner}/${cfg.repo}@${cfg.branch}` : "GitHub — sign in for one-click version control";
  const dot = btn.querySelector(".gh-dot"); if (dot) dot.style.display = connected ? "block" : "none";
}

export async function onGithubClick() {
  const cfg = await store.getGithub();
  if (cfg.token && cfg.owner && cfg.repo) return openGithubMenu();
  return openGithubConnect();
}

export async function openGithubConnect() {
  const { UI } = CTX; const cfg = await store.getGithub();
  UI.modal({
    wide: true, title: "Sign in to GitHub", subtitle: "Connect a repository for one-click pull / push version control of your Salesforce code.",
    bodyHtml: `
      <div class="field"><label>Personal Access Token</label><input id="ghToken" type="password" placeholder="github_pat_… or ghp_…" value="${escapeHtml(cfg.token || "")}" spellcheck="false"><span class="hint">Create a token with <b>repo</b> scope (classic) or Contents read/write (fine-grained). Stored locally in the extension only.</span></div>
      <div class="field-row"><div class="field"><label>Owner (user/org)</label><input id="ghOwner" placeholder="your-username" value="${escapeHtml(cfg.owner || "")}" spellcheck="false"></div><div class="field"><label>Repository</label><input id="ghRepo" list="ghRepoList" placeholder="my-sf-repo" value="${escapeHtml(cfg.repo || "")}" spellcheck="false"><datalist id="ghRepoList"></datalist></div></div>
      <div class="field-row"><div class="field"><label>Branch</label><input id="ghBranch" placeholder="main" value="${escapeHtml(cfg.branch || "main")}" spellcheck="false"></div><div class="field"><label>Base path in repo</label><input id="ghBase" placeholder="force-app/main/default" value="${escapeHtml(cfg.basePath || "force-app/main/default")}" spellcheck="false"></div></div>
      <div id="ghConnMsg" class="hint"></div>`,
    actions: [
      { label: "Verify token", kind: "ghost", keepOpen: true, onClick: async (root) => {
          const token = root.querySelector("#ghToken").value.trim(); const msg = root.querySelector("#ghConnMsg");
          if (!token) { UI.toast("Enter a token", "", "warn"); return true; }
          msg.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Verifying…`;
          try { const gh = new GitHub({ token }); const user = await gh.verify(token); msg.innerHTML = `✓ Signed in as <b>${escapeHtml(user.login)}</b>`; if (!root.querySelector("#ghOwner").value) root.querySelector("#ghOwner").value = user.login; try { const repos = await gh.listRepos(); root.querySelector("#ghRepoList").innerHTML = repos.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.full_name)}</option>`).join(""); } catch {} }
          catch (e) { msg.innerHTML = `<span style="color:var(--danger)">✗ ${escapeHtml(e.message)}</span>`; }
          return true; } },
      { label: "Cancel", kind: "ghost" },
      { label: "Save & Connect", kind: "primary", keepOpen: true, onClick: async (root) => {
          const token = root.querySelector("#ghToken").value.trim(); const owner = root.querySelector("#ghOwner").value.trim(); const repo = root.querySelector("#ghRepo").value.trim(); const branch = root.querySelector("#ghBranch").value.trim() || "main"; const basePath = root.querySelector("#ghBase").value.trim();
          if (!token || !owner || !repo) { UI.toast("Missing details", "Token, owner and repository are required.", "warn"); return true; }
          try { const gh = new GitHub({ token }); const user = await gh.verify(token); await store.saveGithub({ token, owner, repo, branch, basePath, user: user.login, connectedAt: new Date().toISOString() }); UI.closeModal(); await githubBadge(); UI.toast("GitHub connected", `${owner}/${repo}@${branch}`, "ok"); }
          catch (e) { UI.toast("Connection failed", e.message, "err", 6000); return true; }
        } },
    ],
    onMount: async (root) => { const token = root.querySelector("#ghToken").value.trim(); if (token && cfg.owner) { try { const gh = new GitHub({ token }); const repos = await gh.listRepos(); root.querySelector("#ghRepoList").innerHTML = repos.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.full_name)}</option>`).join(""); } catch {} } },
  });
}

export async function openGithubMenu() {
  const { UI } = CTX; const cfg = await store.getGithub();
  UI.modal({
    title: "GitHub Version Control", subtitle: `${cfg.owner}/${cfg.repo} · branch ${cfg.branch}`,
    bodyHtml: `
      <div class="gh-actions">
        <button class="gh-act" data-a="pushActive"><span class="gh-act-ico">${Icons.gitpush}</span><span><b>Push active file</b><small>Commit the file open in the editor</small></span></button>
        <button class="gh-act" data-a="pushAll"><span class="gh-act-ico">${Icons.gitpush}</span><span><b>Push all code</b><small>Commit every Apex/LWC/Aura/VF/Static Resource in one commit</small></span></button>
        <button class="gh-act" data-a="pull"><span class="gh-act-ico">${Icons.gitpull}</span><span><b>Pull from repo</b><small>Browse repo files and open them in the editor</small></span></button>
      </div>
      <div id="ghProgress" class="console muted" style="margin-top:10px;max-height:30vh;overflow:auto">Ready.</div>`,
    actions: [ { label: "Reconfigure", kind: "ghost", onClick: () => { UI.closeModal(); openGithubConnect(); } }, { label: "Sign out", kind: "ghost", onClick: async () => { await store.clearGithub(); await githubBadge(); UI.toast("Signed out of GitHub", "", "ok"); } }, { label: "Close", kind: "primary" } ],
    onMount: (root) => { root.querySelectorAll(".gh-act").forEach((b) => (b.onclick = () => { const log = (m, cls = "") => { const el = root.querySelector("#ghProgress"); el.classList.remove("muted"); const d = document.createElement("div"); if (cls) d.className = cls; d.textContent = m; el.appendChild(d); el.scrollTop = el.scrollHeight; }; const a = b.dataset.a; if (a === "pushActive") gitPushActive(log); else if (a === "pushAll") gitPushAll(log); else if (a === "pull") { UI.closeModal(); gitPull(); } })); },
  });
}

async function ghClient() { const gh = await GitHub.load(); if (!gh.connected) throw new Error("Connect GitHub first."); return gh; }

export async function gitPushActive(log = () => {}) {
  const { app, UI } = CTX; const tab = app.tabs.find((t) => t.id === app.activeTabId);
  if (!tab) return UI.toast("No file open", "Open a component first.", "warn");
  try {
    const gh = await ghClient();
    const files = tab.files.map((f) => ({ path: repoPathFor(tab.node, f), content: (tab.editor && f === tab.files[tab.activeFile] ? tab.editor.getValue() : f.body) }));
    log(`Committing ${files.length} file(s) for ${tab.node.name}…`);
    const res = await gh.commitFiles(files, `OrgStudio: update ${tab.node.name}`, (m) => log(m));
    log(`✓ Pushed. Commit ${res.commitSha.slice(0, 7)} on ${res.branch}.`, "ln-ok");
    UI.toast("Pushed to GitHub", `${tab.node.name} → ${res.branch}`, "ok");
  } catch (e) { log(`✗ ${e.message}`, "ln-err"); UI.toast("Push failed", e.message, "err", 6000); }
}

export async function gitPushAll(log = () => {}) {
  const { app, UI } = CTX;
  if (!app.org) return UI.toast("Connect an org first", "", "warn");
  try {
    const gh = await ghClient();
    const groups = app.tree || [];
    const files = []; let fetched = 0; const total = groups.reduce((n, g) => n + g.nodes.length, 0);
    log(`Collecting source for ${total} component(s)…`);
    for (const g of groups) {
      for (const node of g.nodes) {
        fetched++;
        try { const opened = await app.meta.open(node); for (const f of opened) files.push({ path: repoPathFor(node, f), content: f.body ?? "" }); if (fetched % 10 === 0) log(`Fetched ${fetched}/${total}…`); }
        catch (e) { log(`• Skipped ${node.name}: ${e.message}`, "ln-warn"); }
      }
    }
    if (!files.length) return UI.toast("Nothing to push", "No source could be read.", "warn");
    log(`Committing ${files.length} file(s) in a single commit…`);
    const res = await gh.commitFiles(files, `OrgStudio: sync ${app.org.username} (${files.length} files)`, (m) => log(m));
    log(`✓ Pushed ${res.count} files. Commit ${res.commitSha.slice(0, 7)}.`, "ln-ok");
    UI.toast("Repo synced", `${res.count} files → ${res.branch}`, "ok");
  } catch (e) { log(`✗ ${e.message}`, "ln-err"); UI.toast("Push failed", e.message, "err", 6000); }
}

export async function gitPull() {
  const { UI } = CTX;
  UI.modal({ wide: true, title: "Pull from GitHub", subtitle: "Files in the repository (base path applied). Click one to open it in the editor.", bodyHtml: `<div class="field"><input id="ghPullFilter" placeholder="Filter files…" autocomplete="off"></div><div class="finder-list" id="ghPullList"><span class="spinner"></span> Loading repository…</div>`, actions: [ { label: "Close", kind: "ghost" } ], onMount: async (root) => {
    const list = root.querySelector("#ghPullList"); const filter = root.querySelector("#ghPullFilter");
    try {
      const gh = await ghClient(); const { files } = await gh.listTree(gh.cfg.branch);
      if (!files.length) { list.innerHTML = `<div class="empty-state">No files found on branch “${escapeHtml(gh.cfg.branch)}”.</div>`; return; }
      const render = (q) => { const f = (q || "").toLowerCase(); const items = files.filter((x) => x.path.toLowerCase().includes(f)).slice(0, 400); list.innerHTML = items.length ? items.map((x, i) => `<div class="finder-item" data-i="${i}"><span class="fi-ico">${Icons.file}</span><span>${escapeHtml(x.path.replace((gh.cfg.basePath ? gh.cfg.basePath + "/" : ""), ""))}</span><span class="fi-type">${(x.size || 0)} B</span></div>`).join("") : `<div class="empty-state">No matches.</div>`; list.querySelectorAll(".finder-item").forEach((el) => (el.onclick = async () => { const x = items[+el.dataset.i]; el.innerHTML = `<span class="spinner"></span> Opening ${escapeHtml(x.path)}…`; try { const content = await gh.getBlob(x.sha); UI.closeModal(); UI.viewer(`GitHub · ${x.path.split("/").pop()}`, content); } catch (e) { UI.toast("Open failed", e.message, "err"); } })); return items; };
      let items = render(""); filter.focus(); filter.oninput = () => (items = render(filter.value));
    } catch (e) { list.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; }
  } });
}

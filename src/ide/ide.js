/* ide.js — Salesforce OrgStudio application controller (full-page IDE). */
import "../vendor/browser-polyfill.js";
import { engineLabel } from "../common/env.js";
import { escapeHtml, timeAgo, fmt, uid, debounce, bytesToBase64 } from "../common/util.js";
import { COMPONENT_TYPES, MSG, PROFILE } from "../common/constants.js";
import * as store from "../core/storage.js";
import * as auth from "../core/auth.js";
import { SFClient } from "../core/sfclient.js";
import { MetadataService } from "../core/metadata.js";
import { DeployEngine } from "../core/deploy.js";
import { DevTools } from "../core/devtools.js";
import { SoqlRunner } from "../core/soql.js";
import { CreateService, validName, CONTENT_TYPES } from "../core/create.js";
import { CodeEditor } from "../editor/editor.js";
import { Icons, brandSvg } from "./icons.js";
import { UI } from "./ui.js";
import { openSoqlExport, openDataImport, openShowAllData } from "../inspector/inspector.js";
import * as GH from "./github-ui.js";
const $ = (s) => document.querySelector(s);
const app = { org: null, client: null, meta: null, deployer: null, dev: null, soql: null, create: null, tree: [], tabs: [], activeTabId: null, settings: null, panelEditors: {}, lastPanelH: 240 };

async function init() {
  app.settings = await store.getSettings();
  applyTheme(app.settings.theme); applyEditorPrefs();
  $("#brandMark").innerHTML = brandSvg(26);
  $("#welcomeMark").innerHTML = brandSvg(64);
  $("#engineLabel").textContent = engineLabel();
  $("#themeBtn").innerHTML = app.settings.theme === "dark" ? Icons.sun : Icons.moon;
  $("#settingsBtn").innerHTML = Icons.gear;
  $("#githubBtn").insertAdjacentHTML("afterbegin", Icons.github);
  $("#nmPlus").innerHTML = Icons.plus; $("#nmCaret").innerHTML = Icons.chevronUp;
  $("#dtIco").innerHTML = Icons.tools; $("#dtCaret").innerHTML = Icons.chevronUp;
  $("#panelToggle").innerHTML = Icons.chevronDown;
  setupBrandPopover();
  GH.initGithub({ app, UI, openNode });
  wireTopbar(); wireResizers(); wirePanels(); wireFindBar(); wireNewMenu(); wireDevMenu(); wirePanelToggle();
  $("#githubBtn").onclick = () => GH.onGithubClick();
  GH.githubBadge();
  $("#welcomeQuick").onclick = quickConnect;
  $("#welcomeOAuth").onclick = openConnectModal;
  await refreshOrgUI();
  const active = await store.getActiveOrg();
  if (active) await connectToOrg(active.id);
  if (app.settings.panelCollapsed) setPanelCollapsed(true, false);
}

function setupBrandPopover() {
  $("#bpiLi").innerHTML = Icons.linkedin; $("#bpiTb").innerHTML = Icons.badge; $("#bpiMail").innerHTML = Icons.mail;
  $("#bpLinkedIn").href = PROFILE.linkedin;
  $("#bpTrail").href = PROFILE.trailblazer;
  const mail = $("#bpMail"); mail.href = `mailto:${PROFILE.email}`; mail.title = PROFILE.email;
  mail.onclick = (e) => { navigator.clipboard.writeText(PROFILE.email).then(() => UI.toast("Email copied", PROFILE.email, "ok")).catch(() => {}); };
}

async function quickConnect() {
  const btn = $("#welcomeQuick"); const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Connecting…`;
  try { const resp = await browser.runtime.sendMessage({ type: MSG.CONNECT_ACTIVE }); if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Could not connect."); await refreshOrgUI(); await connectToOrg(resp.org.id); }
  catch (e) { UI.toast("Couldn't auto-connect", e.message, "err", 6000); UI.modal({ title: "Connect to your open org", subtitle: "OrgStudio couldn't read a Salesforce session automatically.", bodyHtml: `<div class="warn-box">Make sure you have a tab open and <b>logged into your Salesforce org</b> (Setup or Lightning) in this same browser, then try again.</div>`, actions: [ { label: "Use OAuth", kind: "ghost", onClick: openConnectModal }, { label: "Try again", kind: "primary", onClick: quickConnect } ] }); }
  finally { btn.disabled = false; btn.innerHTML = original; }
}

async function refreshOrgUI() {
  const orgs = await store.getOrgs(); const list = Object.values(orgs); const activeId = await store.getActiveOrgId();
  const menu = $("#orgMenu"); menu.innerHTML = "";
  list.forEach((o) => {
    const item = document.createElement("div"); item.className = "org-menu-item" + (o.id === activeId ? " active" : "");
    item.innerHTML = `<span class="org-dot ${o.isSandbox ? "sandbox" : "prod"}"></span><span class="org-meta"><span class="org-username">${escapeHtml(o.username)}</span><span class="org-instance">${escapeHtml(shortHost(o.instanceUrl))} · ${o.isSandbox ? "Sandbox" : "Production"}${o.connMethod === "session" ? " · session" : ""}</span></span><button class="btn ghost sm disconnect" title="Disconnect">${Icons.x}</button>`;
    item.querySelector(".org-meta").onclick = () => { closeAllMenus(); connectToOrg(o.id); };
    item.querySelector(".org-dot").onclick = () => { closeAllMenus(); connectToOrg(o.id); };
    item.querySelector(".disconnect").onclick = async (e) => { e.stopPropagation(); if (await UI.confirm("Disconnect org?", `Remove ${o.username} and its stored tokens from OrgStudio?`)) { await auth.disconnect(o.id); if (app.org && app.org.id === o.id) resetWorkspace(); await refreshOrgUI(); UI.toast("Disconnected", o.username, "ok"); } };
    menu.appendChild(item);
  });
  const sep = document.createElement("div"); sep.className = "org-menu-sep"; menu.appendChild(sep);
  const quick = document.createElement("div"); quick.className = "org-menu-item org-menu-add"; quick.innerHTML = `<span class="org-dot"></span><span>Connect to your open org (1-click)</span>`; quick.onclick = () => { closeAllMenus(); quickConnect(); }; menu.appendChild(quick);
  const add = document.createElement("div"); add.className = "org-menu-item"; add.style.color = "var(--text-dim)"; add.innerHTML = `<span class="org-dot"></span><span>Connect with OAuth…</span>`; add.onclick = () => { closeAllMenus(); openConnectModal(); }; menu.appendChild(add);
}

function updateOrgHeader() {
  const o = app.org;
  $("#orgUsername").textContent = o ? o.username : "Not connected";
  $("#orgInstance").textContent = o ? `${shortHost(o.instanceUrl)} · ${o.orgType || (o.isSandbox ? "Sandbox" : "Production")}` : "Connect an org to begin";
  $("#orgDot").className = "org-dot " + (o ? (o.isSandbox ? "sandbox" : "prod") : "");
  const badge = $("#envBadge");
  if (o) { badge.hidden = false; badge.textContent = o.isSandbox ? "Sandbox" : "Production"; badge.className = "env-badge " + (o.isSandbox ? "sandbox" : "prod"); } else badge.hidden = true;
  $("#deployBtn").disabled = !o;
  $("#statusApi").textContent = o ? `API v${app.client ? app.client.apiVersion : o.apiVersion}` : "";
}

async function connectToOrg(orgId) {
  const org = await store.getOrg(orgId); if (!org) return;
  await store.setActiveOrgId(orgId);
  app.org = org; app.client = new SFClient(org);
  if (app.settings.apiVersion) app.client.apiVersion = app.settings.apiVersion;
  app.meta = new MetadataService(app.client); app.deployer = new DeployEngine(app.client); app.dev = new DevTools(app.client); app.soql = new SoqlRunner(app.client); app.create = new CreateService(app.client);
  updateOrgHeader(); await refreshOrgUI(); $("#welcome").hidden = true;
  UI.toast("Connected", `${org.username} (${org.isSandbox ? "Sandbox" : "Production"})`, "ok");
  await loadTree(); await restoreTabs(); refreshApiLimit();
}

function resetWorkspace() {
  app.org = app.client = app.meta = app.deployer = app.dev = app.soql = app.create = null; app.tabs = []; app.activeTabId = null;
  $("#tabstrip").innerHTML = ""; $("#editorHost").querySelectorAll(".tab-view").forEach((v) => v.remove());
  $("#tree").innerHTML = `<div class="tree-empty">Connect an org to browse metadata.</div>`; $("#welcome").hidden = false; updateOrgHeader();
  $("#statusPos").textContent = "Ln 1, Col 1";
}

async function loadTree() {
  const tree = $("#tree"); tree.innerHTML = `<div class="tree-empty"><span class="spinner"></span><br><br>Loading metadata…</div>`;
  try {
    const [classes, triggers, pages, comps, lwc, aura, statics] = await Promise.all([
      app.meta.listApexClasses().catch(() => []), app.meta.listApexTriggers().catch(() => []),
      app.meta.listVisualforcePages().catch(() => []), app.meta.listVisualforceComponents().catch(() => []),
      app.meta.listLwcBundles().catch(() => []), app.meta.listAuraBundles().catch(() => []),
      app.meta.listStaticResources().catch(() => []),
    ]);
    app.tree = [
      { type: "ApexClass", label: COMPONENT_TYPES.ApexClass.label, icon: "class", nodes: classes },
      { type: "ApexTrigger", label: COMPONENT_TYPES.ApexTrigger.label, icon: "trigger", nodes: triggers },
      { type: "LightningComponentBundle", label: COMPONENT_TYPES.LightningComponentBundle.label, icon: "lwc", nodes: lwc },
      { type: "AuraDefinitionBundle", label: COMPONENT_TYPES.AuraDefinitionBundle.label, icon: "aura", nodes: aura },
      { type: "ApexPage", label: COMPONENT_TYPES.ApexPage.label, icon: "vf", nodes: pages },
      { type: "ApexComponent", label: COMPONENT_TYPES.ApexComponent.label, icon: "vf", nodes: comps },
      { type: "StaticResource", label: COMPONENT_TYPES.StaticResource.label, icon: "resource", nodes: statics },
    ];
    renderTree();
  } catch (e) { tree.innerHTML = `<div class="tree-empty">Failed to load metadata.<br><span class="muted">${escapeHtml(e.message)}</span></div>`; }
}

function renderTree(filter = "") {
  const tree = $("#tree"); const f = filter.trim().toLowerCase(); tree.innerHTML = ""; let any = false;
  for (const group of app.tree) {
    const nodes = f ? group.nodes.filter((n) => n.name.toLowerCase().includes(f)) : group.nodes;
    if (f && nodes.length === 0) continue; any = any || nodes.length > 0;
    const g = document.createElement("div"); g.className = "tree-group" + (f ? "" : (group.nodes.length > 200 ? " collapsed" : ""));
    g.innerHTML = `<div class="tree-group-head">${Icons.twisty}<span>${escapeHtml(group.label)}</span><span class="count">${nodes.length}</span></div><div class="tree-children"></div>`;
    g.querySelector(".tree-group-head").onclick = () => g.classList.toggle("collapsed");
    const children = g.querySelector(".tree-children");
    for (const node of nodes) {
      const item = document.createElement("div"); item.className = "tree-item"; item.dataset.id = node.id;
      const sub = node.apiVersion ? `v${node.apiVersion}` : (node.sobject || "");
      item.innerHTML = `<span class="ti-icon">${Icons[group.icon] || Icons.file}</span><span class="ti-name" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span><span class="ti-sub">${escapeHtml(sub)}</span>`;
      item.onclick = () => openNode(node); children.appendChild(item);
    }
    tree.appendChild(g);
  }
  if (!any) tree.innerHTML = `<div class="tree-empty">No components match “${escapeHtml(filter)}”.</div>`;
}

async function openNode(node) {
  const existing = app.tabs.find((t) => t.node.id === node.id && t.node.type === node.type);
  if (existing) return activateTab(existing.id);
  UI.toast("Opening", node.name, "run", 900);
  let files; try { files = await app.meta.open(node); } catch (e) { return UI.toast("Failed to open", e.message, "err"); }
  const tab = { id: uid(), node, files, activeFile: 0, editor: null, dirty: false };
  app.tabs.push(tab); await store.pushRecent(app.org.id, { key: `${node.type}:${node.id}`, name: node.name, type: node.type });
  renderTabs(); activateTab(tab.id); persistTabs();
}

function renderTabs() {
  const strip = $("#tabstrip"); strip.innerHTML = "";
  for (const tab of app.tabs) {
    const el = document.createElement("div"); el.className = "etab" + (tab.id === app.activeTabId ? " active" : "");
    el.innerHTML = `<span class="etab-icon">${iconForFile(tab.files[tab.activeFile])}</span><span class="etab-name">${escapeHtml(tab.node.name)}</span><span class="etab-close">${tab.dirty ? '<span class="dirty-dot"></span>' : Icons.x}</span>`;
    el.onclick = (e) => { if (!e.target.closest(".etab-close")) activateTab(tab.id); };
    el.querySelector(".etab-close").onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
    strip.appendChild(el);
  }
}

function activateTab(tabId) {
  app.activeTabId = tabId; const tab = app.tabs.find((t) => t.id === tabId); if (!tab) return;
  $("#welcome").hidden = true; const host = $("#editorHost");
  host.querySelectorAll(".tab-view").forEach((v) => (v.style.display = "none"));
  let view = host.querySelector(`[data-tab="${tabId}"]`);
  if (!view) {
    view = document.createElement("div"); view.className = "tab-view"; view.dataset.tab = tabId;
    view.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;";
    // per-tab actions bar: (bundle file switch) + Save-to-computer
    const bar = document.createElement("div"); bar.className = "tab-actions";
    if (tab.files.length > 1) {
      const files = document.createElement("div"); files.className = "bundle-files";
      tab.files.forEach((file, i) => { const b = document.createElement("button"); b.className = "btn ghost sm"; b.dataset.fi = i; b.innerHTML = `<span style="width:13px;height:13px">${iconForFile(file)}</span> ${escapeHtml(file.name)}`; b.onclick = () => switchBundleFile(tab, i); files.appendChild(b); });
      bar.appendChild(files); view._bundleBar = files;
    }
    const spacer = document.createElement("div"); spacer.className = "spacer"; bar.appendChild(spacer);
    const saveBtn = document.createElement("button"); saveBtn.className = "btn ghost sm"; saveBtn.title = "Save this component to your computer (Downloads/OrgStudio Components)"; saveBtn.innerHTML = `<span style="width:14px;height:14px">${Icons.download}</span> Save to computer`;
    saveBtn.onclick = () => saveComponentLocally(tab); bar.appendChild(saveBtn);
    view.appendChild(bar);
    const mount = document.createElement("div"); mount.style.cssText = "flex:1;min-height:0;position:relative;"; view.appendChild(mount); host.appendChild(view);
    const file = tab.files[tab.activeFile];
    tab.editor = new CodeEditor(mount, { language: file.language, value: file.body, tabSize: app.settings.tabSize, wordWrap: app.settings.wordWrap, autoCloseBrackets: app.settings.autoCloseBrackets, lineHeight: app.settings.lineHeight, lineNumbers: app.settings.showLineNumbers, onChange: (val, dirty) => { tab.files[tab.activeFile].body = val; tab.files[tab.activeFile]._dirty = dirty; tab.dirty = tab.files.some((f) => f._dirty); renderTabs(); } });
    tab.editor.on("save", () => deployActive());
    tab.editor.on("find", () => toggleFindBar(true));
    tab.editor.on("replace", () => toggleFindBar(true));
    tab.editor.on("cursor", ({ line, column }) => setStatusCursor(line, column));
    highlightBundleBar(view, tab.activeFile);
  }
  view.style.display = "flex"; if (tab.editor) setTimeout(() => tab.editor.focus(), 0); renderTabs();
}
function switchBundleFile(tab, index) { tab.activeFile = index; const file = tab.files[index]; tab.editor.setLanguage(file.language); tab.editor.setValue(file.body); highlightBundleBar($(`#editorHost [data-tab="${tab.id}"]`), index); renderTabs(); }
function highlightBundleBar(view, index) { if (!view || !view._bundleBar) return; view._bundleBar.querySelectorAll("button").forEach((b) => { b.classList.toggle("primary", +b.dataset.fi === index); b.classList.toggle("ghost", +b.dataset.fi !== index); }); }
async function closeTab(tabId) {
  const tab = app.tabs.find((t) => t.id === tabId);
  if (tab && tab.dirty) { if (!(await UI.confirm("Close without saving?", `${tab.node.name} has unsaved changes.`))) return; }
  app.tabs = app.tabs.filter((t) => t.id !== tabId);
  const view = $(`#editorHost [data-tab="${tabId}"]`); if (view) view.remove();
  if (app.activeTabId === tabId) { app.activeTabId = app.tabs.length ? app.tabs[app.tabs.length - 1].id : null; if (app.activeTabId) activateTab(app.activeTabId); else $("#welcome").hidden = false; }
  renderTabs(); persistTabs();
}
function activeTab() { return app.tabs.find((t) => t.id === app.activeTabId); }

/* ---- Save component to computer (Downloads/OrgStudio Components/…) ---- */
async function saveComponentLocally(tab) {
  const folder = "OrgStudio Components";
  const isBundle = tab.files.length > 1;
  try {
    for (const f of tab.files) {
      const path = isBundle ? `${folder}/${tab.node.name}/${f.name}` : `${folder}/${f.name}`;
      await downloadToComputer(path, f.body, "text/plain");
    }
    UI.toast("Saved to computer", isBundle ? `${tab.node.name} (${tab.files.length} files) → ${folder}/` : `${tab.files[0].name} → ${folder}/`, "ok");
  } catch (e) { UI.toast("Save failed", e.message, "err", 6000); }
}
async function downloadToComputer(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type: type || "application/octet-stream" }));
  try {
    if (browser.downloads && browser.downloads.download) { await browser.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" }); }
    else { const a = document.createElement("a"); a.href = url; a.download = filename.split("/").pop(); a.click(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

async function deployActive() {
  const tab = activeTab(); if (!tab) return UI.toast("Nothing to save", "Open a file first.", "warn");
  if (!app.org.isSandbox && app.settings.confirmProdDeploy) { if (!(await UI.confirmProd(app.org))) return; }
  await doDeploy(tab);
}
async function doDeploy(tab) {
  setPanel("deploy"); if ($(".workbench").classList.contains("panel-collapsed")) setPanelCollapsed(false);
  const out = panelConsole(); out.textContent = "";
  const log = (m, cls = "") => { const s = document.createElement("div"); s.className = cls; s.textContent = m; out.appendChild(s); out.scrollTop = out.scrollHeight; };
  tab.editor.clearErrors(); const memberType = tab.node.type;
  try {
    let result;
    if (["ApexClass", "ApexTrigger", "ApexPage", "ApexComponent"].includes(memberType)) { const file = tab.files[0]; file.body = tab.editor.getValue(); log(`Deploying ${file.name} via Tooling MetadataContainer…`); result = await app.deployer.saveApex([file], (m) => log(m)); }
    else if (memberType === "LightningComponentBundle") { const file = tab.files[tab.activeFile]; file.body = tab.editor.getValue(); log(`Saving LWC resource ${file.name}…`); result = await app.deployer.saveLwcResource(file, (m) => log(m)); }
    else if (memberType === "AuraDefinitionBundle") { const file = tab.files[tab.activeFile]; file.body = tab.editor.getValue(); log(`Saving Aura definition ${file.name}…`); result = await app.deployer.saveAuraDefinition(file, (m) => log(m)); }
    else return UI.toast("Not supported", `Deploy for ${memberType} not implemented in this build.`, "warn");
    if (result.success) { log("✓ Deploy completed successfully.", "ln-ok"); tab.dirty = false; tab.files.forEach((f) => (f._dirty = false)); tab.editor.markClean(); renderTabs(); setProblems([]); UI.toast("Deployed", `${tab.node.name} saved to ${app.org.isSandbox ? "sandbox" : "production"}.`, "ok"); if (app.settings.githubAutoPush) { const gh = await store.getGithub(); if (gh.token && gh.owner && gh.repo) { log("Auto-pushing to GitHub…"); GH.gitPushActive((m, cls) => log(m, cls)); } } }
    else { log(`✗ Deploy failed (${result.state}).`, "ln-err"); if (result.message) log(result.message, "ln-err"); (result.errors || []).forEach((er) => log(`  ${er.file || ""}${er.line ? `:${er.line}` : ""} — ${er.problem}`, "ln-err")); tab.editor.markErrors(result.errors || []); setProblems(result.errors || [], tab); UI.toast("Deploy failed", `${(result.errors || []).length} problem(s). See Problems tab.`, "err"); }
  } catch (e) { log(`✗ ${e.message}`, "ln-err"); UI.toast("Deploy error", e.message, "err"); }
  refreshApiLimit();
}

function wirePanels() { $("#panelTabs").querySelectorAll(".panel-tab").forEach((t) => (t.onclick = () => { setPanel(t.dataset.panel); if ($(".workbench").classList.contains("panel-collapsed")) setPanelCollapsed(false); })); setPanel("deploy"); }
function setPanel(name) { $("#panelTabs").querySelectorAll(".panel-tab").forEach((t) => t.classList.toggle("active", t.dataset.panel === name)); const body = $("#panelBody"); body.innerHTML = ""; ({ deploy: renderDeployPanel, anon: renderAnonPanel, tests: renderTestsPanel, logs: renderLogsPanel, soql: renderSoqlPanel, problems: renderProblemsPanel }[name] || renderDeployPanel)(body); }
function panelConsole() { let c = $("#panelBody .console"); if (!c) { c = document.createElement("div"); c.className = "console"; $("#panelBody").appendChild(c); } return c; }
function renderDeployPanel(body) { body.innerHTML = `<div class="console muted">Deploy output appears here. Press <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> in the editor to save the active file.</div>`; }
function renderAnonPanel(body) {
  body.innerHTML = `<div class="toolbar-row"><button class="btn primary sm" id="runAnon">${Icons.play} Run</button><span class="muted">Ctrl/Cmd+Enter to run</span></div><div class="mini-editor" id="anonEditor"></div><div class="console" id="anonOut"></div>`;
  if (!app.panelEditors.anon) app.panelEditors.anon = { value: "System.debug('Hello from OrgStudio');" };
  const ed = new CodeEditor($("#anonEditor"), { language: "apex", value: app.panelEditors.anon.value, tabSize: app.settings.tabSize, autoCloseBrackets: app.settings.autoCloseBrackets, lineHeight: app.settings.lineHeight, lineNumbers: app.settings.showLineNumbers, onChange: (v) => (app.panelEditors.anon.value = v) });
  const run = async () => { const out = $("#anonOut"); out.textContent = "Running…"; try { const res = await app.dev.executeAnonymous(ed.getValue()); out.innerHTML = ""; const head = document.createElement("div"); head.className = res.success ? "ln-ok" : "ln-err"; head.textContent = res.success ? "✓ Executed successfully" : `✗ ${res.message}`; out.appendChild(head); if (res.log) { const pre = document.createElement("div"); pre.textContent = res.log; out.appendChild(pre); } } catch (e) { out.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; } refreshApiLimit(); };
  $("#runAnon").onclick = run; ed.root.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); } });
}
function renderTestsPanel(body) {
  body.innerHTML = `<div class="toolbar-row"><input id="testClass" placeholder="Test class name (e.g. MyClass_Test)" style="flex:1;background:var(--editor-bg);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);outline:none;"><button class="btn primary sm" id="runTests">${Icons.play} Run Tests</button></div><div id="testOut" class="console muted">Enter a test class and run. Results and coverage appear here.</div>`;
  $("#runTests").onclick = async () => { const name = $("#testClass").value.trim(); if (!name) return UI.toast("Enter a class", "Provide a test class name.", "warn"); const out = $("#testOut"); out.innerHTML = `<span class="spinner"></span> Running tests…`; try { const res = await app.dev.runTests([{ className: name }], (m) => (out.innerHTML = `<span class="spinner"></span> ${escapeHtml(m)}`)); renderTestResults(out, res); } catch (e) { out.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; } refreshApiLimit(); };
}
function renderTestResults(out, res) {
  const s = res.summary;
  out.innerHTML = `<div class="row-between" style="margin-bottom:10px"><div><span class="pill ${s.failed ? "fail" : "ok"}">${s.passed}/${s.total} passed</span>${s.failed ? `<span class="pill fail" style="margin-left:6px">${s.failed} failed</span>` : ""}</div></div>`;
  const table = document.createElement("table"); table.className = "result-table"; table.innerHTML = `<thead><tr><th>Class</th><th>Method</th><th>Result</th><th>Time</th><th>Message</th></tr></thead>`;
  const tb = document.createElement("tbody");
  res.results.forEach((r) => { const tr = document.createElement("tr"); tr.innerHTML = `<td>${escapeHtml(r.ApexClass && r.ApexClass.Name)}</td><td>${escapeHtml(r.MethodName)}</td><td><span class="pill ${r.Outcome === "Pass" ? "ok" : "fail"}">${r.Outcome}</span></td><td>${r.RunTime ?? ""}ms</td><td>${escapeHtml(r.Message || "")}</td>`; tb.appendChild(tr); });
  table.appendChild(tb); out.appendChild(table);
  if (res.coverage && res.coverage.length) { const h = document.createElement("div"); h.style.cssText = "margin:14px 0 6px;font-weight:600"; h.textContent = "Code coverage"; out.appendChild(h); const ct = document.createElement("table"); ct.className = "result-table"; ct.innerHTML = `<thead><tr><th>Class/Trigger</th><th>Coverage</th><th>Lines</th></tr></thead>`; const cb = document.createElement("tbody"); res.coverage.forEach((c) => { const cls = c.percent >= 75 ? "" : c.percent >= 50 ? "mid" : "low"; const tr = document.createElement("tr"); tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td><span class="cov-bar"><span class="cov-fill ${cls}" style="width:${c.percent}%"></span></span> ${c.percent}%</td><td>${c.covered}/${c.total}</td>`; cb.appendChild(tr); }); ct.appendChild(cb); out.appendChild(ct); }
}
function renderLogsPanel(body) {
  body.innerHTML = `<div class="toolbar-row"><button class="btn ghost sm" id="refreshLogs">${Icons.play} Load recent logs</button><span class="muted">Enables a 1-hour TraceFlag for your user when you run anonymous Apex.</span></div><div id="logList"></div>`;
  $("#refreshLogs").onclick = async () => { const list = $("#logList"); list.innerHTML = `<span class="spinner"></span> Loading…`; try { const logs = await app.dev.listLogs(30); if (!logs.length) { list.innerHTML = `<div class="empty-state">No debug logs found.</div>`; return; } const table = document.createElement("table"); table.className = "result-table"; table.innerHTML = `<thead><tr><th>User</th><th>Operation</th><th>Status</th><th>Size</th><th>Duration</th><th>Time</th></tr></thead>`; const tb = document.createElement("tbody"); logs.forEach((lg) => { const tr = document.createElement("tr"); tr.style.cursor = "pointer"; tr.innerHTML = `<td>${escapeHtml(lg.LogUser && lg.LogUser.Name)}</td><td>${escapeHtml(lg.Operation)}</td><td>${escapeHtml(lg.Status)}</td><td>${fmt(lg.LogLength)}</td><td>${lg.DurationMilliseconds}ms</td><td>${timeAgo(lg.StartTime)}</td>`; tr.onclick = async () => { const t = await app.dev.getLogBody(lg.Id); UI.viewer(`Debug Log · ${lg.Operation}`, t); }; tb.appendChild(tr); }); table.appendChild(tb); list.innerHTML = ""; list.appendChild(table); } catch (e) { list.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; } };
}
function renderSoqlPanel(body) {
  body.innerHTML = `<div class="toolbar-row"><button class="btn primary sm" id="runSoql">${Icons.play} Run</button><label class="muted" style="display:flex;gap:5px;align-items:center"><input type="checkbox" id="soqlTooling"> Tooling API</label><button class="btn ghost sm" id="exportCsv">Export CSV</button><span class="muted" id="soqlCount"></span></div><div class="mini-editor" id="soqlEditor"></div><div id="soqlResults"></div>`;
  if (!app.panelEditors.soql) app.panelEditors.soql = { value: "SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 50" };
  const ed = new CodeEditor($("#soqlEditor"), { language: "apex", value: app.panelEditors.soql.value, tabSize: app.settings.tabSize, autoCloseBrackets: app.settings.autoCloseBrackets, lineHeight: app.settings.lineHeight, lineNumbers: app.settings.showLineNumbers, onChange: (v) => (app.panelEditors.soql.value = v) });
  let last = null;
  const run = async () => { const res = $("#soqlResults"); res.innerHTML = `<span class="spinner"></span> Querying…`; try { const r = await app.soql.run(ed.getValue(), { tooling: $("#soqlTooling").checked }); last = r; $("#soqlCount").textContent = `${fmt(r.totalSize)} rows`; res.innerHTML = ""; if (!r.rows.length) { res.innerHTML = `<div class="empty-state">No rows.</div>`; return; } const table = document.createElement("table"); table.className = "result-table"; table.innerHTML = `<thead><tr>${r.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`; const tb = document.createElement("tbody"); r.rows.forEach((row) => { const tr = document.createElement("tr"); tr.innerHTML = r.columns.map((c) => `<td>${escapeHtml(row[c] ?? "")}</td>`).join(""); tb.appendChild(tr); }); table.appendChild(tb); res.appendChild(table); } catch (e) { res.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; } refreshApiLimit(); };
  $("#runSoql").onclick = run;
  $("#exportCsv").onclick = () => { if (!last) return UI.toast("Nothing to export", "Run a query first.", "warn"); downloadFile("query-results.csv", app.soql.toCsv(last.columns, last.rows), "text/csv"); };
  ed.root.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); } });
}
let currentProblems = [];
function setProblems(problems, tab) { currentProblems = (problems || []).map((p) => ({ ...p, tabId: tab && tab.id })); const badge = $("#problemsBadge"); badge.hidden = currentProblems.length === 0; badge.textContent = currentProblems.length; }
function renderProblemsPanel(body) { if (!currentProblems.length) { body.innerHTML = `<div class="empty-state">No problems. Nice and clean. ✨</div>`; return; } currentProblems.forEach((p) => { const el = document.createElement("div"); el.className = "problem"; el.innerHTML = `<span class="p-icon">${Icons.alert}</span><div><div>${escapeHtml(p.problem)}</div><div class="p-loc">${escapeHtml(p.file || "")}${p.line ? ` · line ${p.line}${p.column ? `, col ${p.column}` : ""}` : ""}</div></div>`; el.onclick = () => { if (p.tabId) { activateTab(p.tabId); const t = app.tabs.find((x) => x.id === p.tabId); if (t && p.line) t.editor.gotoLine(p.line); } }; body.appendChild(el); }); }

/* ---- panel collapse / expand ---- */
function wirePanelToggle() { $("#panelToggle").onclick = () => setPanelCollapsed(!$(".workbench").classList.contains("panel-collapsed")); }
function setPanelCollapsed(collapsed, persist = true) {
  const wb = $(".workbench");
  if (collapsed) { const cur = parseInt(getComputedStyle(wb).getPropertyValue("--panel-h")) || 240; if (cur > 60) app.lastPanelH = cur; wb.classList.add("panel-collapsed"); $("#panelToggle").title = "Expand panel"; }
  else { wb.classList.remove("panel-collapsed"); wb.style.setProperty("--panel-h", (app.lastPanelH || 240) + "px"); $("#panelToggle").title = "Collapse panel"; }
  if (persist) store.saveSettings({ panelCollapsed: collapsed }).then((s) => (app.settings = s));
}

function wireFindBar() {
  $("#findClose").onclick = () => toggleFindBar(false);
  $("#findNext").onclick = () => { const t = activeTab(); if (t) t.editor.find($("#findInput").value, { from: t.editor.input.selectionEnd }); };
  $("#replaceOne").onclick = () => { const t = activeTab(); if (t) t.editor.replaceCurrent($("#findInput").value, $("#replaceInput").value); };
  $("#replaceAllBtn").onclick = () => { const t = activeTab(); if (t) { const n = t.editor.replaceAll($("#findInput").value, $("#replaceInput").value); UI.toast("Replaced", `${n} occurrence(s).`, "ok"); } };
  $("#findInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#findNext").click(); if (e.key === "Escape") toggleFindBar(false); });
}
function toggleFindBar(show) { $("#findBar").hidden = !show; if (show) $("#findInput").focus(); else { const t = activeTab(); if (t) t.editor.focus(); } }
function wireTopbar() {
  $("#orgCurrentBtn").onclick = (e) => { e.stopPropagation(); const m = $("#orgMenu"); m.hidden = !m.hidden; };
  document.addEventListener("click", (e) => { if (!e.target.closest("#orgSwitcher")) $("#orgMenu").hidden = true; if (!e.target.closest("#newMenuWrap")) $("#newMenu").hidden = true; if (!e.target.closest("#devMenuWrap")) $("#devMenu").hidden = true; });
  $("#deployBtn").onclick = () => deployActive();
  $("#themeBtn").onclick = toggleTheme;
  $("#settingsBtn").onclick = openSettings;
  $("#refreshTreeBtn").onclick = () => loadTree();
  $("#treeSearch").addEventListener("input", debounce((e) => renderTree(e.target.value), 120));
}
function closeAllMenus() { $("#orgMenu").hidden = true; $("#newMenu").hidden = true; $("#devMenu").hidden = true; }

/* ============================================================ New / Upload menu */
function wireNewMenu() { $("#newMenuBtn").onclick = (e) => { e.stopPropagation(); $("#devMenu").hidden = true; const m = $("#newMenu"); if (m.hidden) buildNewMenu(); m.hidden = !m.hidden; }; }
function buildNewMenu() {
  const m = $("#newMenu");
  const item = (icon, label, fn) => `<div class="nm-item" data-fn="${fn}"><span class="nm-ico">${Icons[icon] || Icons.file}</span><span>${label}</span></div>`;
  m.innerHTML = `<div class="nm-section">Create new</div>` + item("class", "Apex Class", "newApexClass") + item("trigger", "Apex Trigger", "newApexTrigger") + item("vf", "Visualforce Page", "newVfPage") + item("lwc", "Lightning Web Component", "newLwc") + item("resource", "Static Resource", "newStaticResource") + `<div class="nm-sep"></div><div class="nm-section">Upload from computer</div>` + item("upload", "Apex / Trigger / VF files…", "uploadApexVf") + item("folder", "LWC folder…", "uploadLwcFolder") + item("resource", "Static Resource file…", "uploadStaticResource");
  m.querySelectorAll(".nm-item").forEach((el) => { el.onclick = () => { $("#newMenu").hidden = true; const fn = el.dataset.fn; ({ newApexClass, newApexTrigger, newVfPage, newLwc, newStaticResource, uploadApexVf, uploadLwcFolder, uploadStaticResource }[fn] || (() => {}))(); }; });
}
function requireOrg() { if (!app.org) { UI.toast("Connect an org first", "Use the button above to connect.", "warn"); return false; } return true; }

/* ============================================================ Developer Tools menu */
function wireDevMenu() { $("#devMenuBtn").onclick = (e) => { e.stopPropagation(); $("#newMenu").hidden = true; const m = $("#devMenu"); if (m.hidden) buildDevMenu(); m.hidden = !m.hidden; }; }
function buildDevMenu() {
  const m = $("#devMenu"); m.classList.add("right");
  const item = (icon, label, fn) => `<div class="nm-item" data-fn="${fn}"><span class="nm-ico">${Icons[icon] || Icons.file}</span><span>${label}</span></div>`;
  m.innerHTML = `<div class="nm-section">Salesforce Inspector</div>` + item("exportData", "SOQL Export", "inspSoql") + item("importData", "Data Import", "inspImport") + item("tableData", "Show All Data", "inspShow") + `<div class="nm-sep"></div><div class="nm-section">Developer tools</div>` + item("search", "Code Finder", "openCodeFinder") + item("bolt", "Anonymous Apex Executor", "openAnonExecutor") + item("rest", "REST API Explorer", "openRestExplorer") + item("graphql", "GraphQL Explorer", "openGraphqlExplorer") + item("package", "Package Manager", "openPackageManager");
  const handlers = { openCodeFinder, openAnonExecutor, openRestExplorer, openGraphqlExplorer, openPackageManager, inspSoql: () => { if (requireOrg()) openSoqlExport(app); }, inspImport: () => { if (requireOrg()) openDataImport(app); }, inspShow: inspShowPrompt };
  m.querySelectorAll(".nm-item").forEach((el) => { el.onclick = () => { $("#devMenu").hidden = true; const fn = el.dataset.fn; (handlers[fn] || (() => {}))(); }; });
}
function inspShowPrompt() {
  if (!requireOrg()) return;
  UI.modal({ title: "Show All Data", subtitle: "Open the full field-level view for any record.", bodyHtml: `<div class="field"><label>Record Id (15 or 18 chars)</label><input id="sadId" placeholder="001..." autocomplete="off" spellcheck="false"></div><div class="field"><label>Object API name (optional)</label><input id="sadObj" placeholder="Auto-detected from Id prefix" autocomplete="off" spellcheck="false"></div>`, actions: [ { label: "Cancel", kind: "ghost" }, { label: "Open", kind: "primary", keepOpen: true, onClick: (root) => { const id = root.querySelector("#sadId").value.trim(); const obj = root.querySelector("#sadObj").value.trim(); if (!/^[A-Za-z0-9]{15,18}$/.test(id)) return UI.toast("Invalid Id", "Enter a 15 or 18 character record Id.", "warn"); UI.closeModal(); openShowAllData(app, { recordId: id, objectName: obj }); } } ], onMount: (root) => root.querySelector("#sadId").focus() });
}
function openAnonExecutor() { setPanel("anon"); if ($(".workbench").classList.contains("panel-collapsed")) setPanelCollapsed(false); }
function openCodeFinder() {
  if (!requireOrg()) return;
  UI.modal({ wide: true, title: "Code Finder", subtitle: "Search every component in the org by name, then open it in the editor.",
    bodyHtml: `<div class="field"><input id="cfInput" placeholder="Type to filter Apex, LWC, Aura, VF, Static Resources…" autocomplete="off"></div><div class="finder-list" id="cfList"></div>`,
    actions: [ { label: "Close", kind: "ghost" } ],
    onMount: (root) => {
      const input = root.querySelector("#cfInput"); const list = root.querySelector("#cfList");
      const all = []; for (const g of app.tree) for (const n of g.nodes) all.push({ node: n, group: g });
      const render = (q) => { const f = q.trim().toLowerCase(); const items = (f ? all.filter((a) => a.node.name.toLowerCase().includes(f)) : all).slice(0, 200); list.innerHTML = items.length ? items.map((a, i) => `<div class="finder-item" data-i="${i}"><span class="fi-ico">${Icons[a.group.icon] || Icons.file}</span><span>${escapeHtml(a.node.name)}</span><span class="fi-type">${escapeHtml(COMPONENT_TYPES[a.node.type] ? COMPONENT_TYPES[a.node.type].label : a.node.type)}</span></div>`).join("") : `<div class="empty-state">No matches.</div>`; list.querySelectorAll(".finder-item").forEach((el) => { el.onclick = () => { const a = items[+el.dataset.i]; UI.closeModal(); openNode(a.node); }; }); return items; };
      let items = render(""); input.focus();
      input.oninput = () => { items = render(input.value); };
      input.onkeydown = (e) => { if (e.key === "Enter" && items[0]) { UI.closeModal(); openNode(items[0].node); } };
    } });
}
function openRestExplorer() {
  if (!requireOrg()) return;
  UI.modal({ wide: true, title: "REST API Explorer", subtitle: "Call any Salesforce REST resource with your active session.",
    bodyHtml: `<div class="field-row small-first"><div class="field"><label>Method</label><select id="reMethod"><option>GET</option><option>POST</option><option>PATCH</option><option>PUT</option><option>DELETE</option></select></div><div class="field"><label>Path or URL</label><input id="rePath" value="/services/data/v${app.client.apiVersion}/limits" spellcheck="false"></div></div><div class="field"><label>Body (JSON, for POST/PATCH/PUT)</label><textarea id="reBody" spellcheck="false" placeholder='{ "Name": "Acme" }'></textarea></div><div id="reOut" class="console muted" style="max-height:34vh;overflow:auto">Response appears here.</div>`,
    actions: [ { label: "Close", kind: "ghost" }, { label: "Send", kind: "primary", keepOpen: true, onClick: async (root) => { const method = root.querySelector("#reMethod").value; const path = root.querySelector("#rePath").value.trim(); const bodyText = root.querySelector("#reBody").value.trim(); const out = root.querySelector("#reOut"); out.classList.remove("muted"); out.innerHTML = `<span class="spinner"></span> Sending…`; try { let body; if (bodyText && ["POST","PATCH","PUT"].includes(method)) body = JSON.parse(bodyText); const res = await app.client.request(path, { method, body }); out.textContent = typeof res === "string" ? res : JSON.stringify(res, null, 2); } catch (e) { out.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; } refreshApiLimit(); return true; } } ] });
}
function openGraphqlExplorer() {
  if (!requireOrg()) return;
  UI.modal({ wide: true, title: "GraphQL Explorer", subtitle: "Run a GraphQL query against the Salesforce GraphQL API.",
    bodyHtml: `<div class="field"><label>Query</label><textarea id="gqQuery" spellcheck="false" style="min-height:150px">query accounts {\n  uiapi {\n    query {\n      Account(first: 5) {\n        edges { node { Id Name { value } } }\n      }\n    }\n  }\n}</textarea></div><div id="gqOut" class="console muted" style="max-height:32vh;overflow:auto">Response appears here.</div>`,
    actions: [ { label: "Close", kind: "ghost" }, { label: "Run", kind: "primary", keepOpen: true, onClick: async (root) => { const q = root.querySelector("#gqQuery").value; const out = root.querySelector("#gqOut"); out.classList.remove("muted"); out.innerHTML = `<span class="spinner"></span> Running…`; try { const res = await app.client.graphql(q); out.textContent = JSON.stringify(res, null, 2); } catch (e) { out.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; } refreshApiLimit(); return true; } } ] });
}
async function openPackageManager() {
  if (!requireOrg()) return;
  UI.modal({ wide: true, title: "Package Manager", subtitle: "Installed managed/unlocked packages in this org.", bodyHtml: `<div id="pmOut"><span class="spinner"></span> Loading installed packages…</div>`, actions: [ { label: "Close", kind: "primary" } ], onMount: async () => {
    const out = $("#pmOut");
    try {
      const { records } = await app.client.toolingQuery(`SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.NamespacePrefix`, { all: true });
      if (!records.length) { out.innerHTML = `<div class="empty-state">No installed packages found.</div>`; return; }
      const rows = records.map((r) => { const sp = r.SubscriberPackage || {}; const v = r.SubscriberPackageVersion || {}; const ver = [v.MajorVersion, v.MinorVersion, v.PatchVersion, v.BuildNumber].filter((x) => x != null).join("."); return `<tr><td>${escapeHtml(sp.Name || "")}</td><td>${escapeHtml(sp.NamespacePrefix || "")}</td><td>${escapeHtml(v.Name || "")}</td><td>${escapeHtml(ver)}</td></tr>`; }).join("");
      out.innerHTML = `<table class="result-table"><thead><tr><th>Package</th><th>Namespace</th><th>Version name</th><th>Version</th></tr></thead><tbody>${rows}</tbody></table>`;
    } catch (e) { out.innerHTML = `<div class="ln-err">✗ ${escapeHtml(e.message)}</div>`; }
  } });
}

/* ============================================================ Create (templates) */
function newApexClass() { if (!requireOrg()) return; UI.modal({ title: "New Apex Class", subtitle: "Creates an empty class in the connected org.", bodyHtml: `<div class="field"><label>Class name</label><input id="cName" placeholder="MyClass" autocomplete="off" /><span class="hint">Must start with a letter; letters, numbers and underscores only.</span></div>`, actions: [ { label: "Cancel", kind: "ghost" }, { label: "Create", kind: "primary", keepOpen: true, onClick: async (root) => { const name = root.querySelector("#cName").value.trim(); if (!validName(name)) return UI.toast("Invalid name", "Use a valid Apex identifier.", "warn"); await runCreate(() => app.create.createApexClass(name), "ApexClass", name); } } ], onMount: (root) => root.querySelector("#cName").focus() }); }
function newApexTrigger() {
  if (!requireOrg()) return;
  UI.modal({ title: "New Apex Trigger", subtitle: "Choose the sObject from your org (all triggerable objects).", bodyHtml: `<div class="field"><label>Trigger name</label><input id="tName" placeholder="MyTrigger" autocomplete="off" /></div><div class="field"><label>sObject</label><input id="tObj" list="sobjList" placeholder="Start typing… (e.g. Account)" autocomplete="off" /><datalist id="sobjList"></datalist><span class="hint" id="tObjHint"><span class="spinner" style="width:11px;height:11px"></span> Loading sObjects…</span></div>`,
    actions: [ { label: "Cancel", kind: "ghost" }, { label: "Create", kind: "primary", keepOpen: true, onClick: async (root) => { const name = root.querySelector("#tName").value.trim(); const obj = root.querySelector("#tObj").value.trim(); if (!validName(name)) return UI.toast("Invalid name", "Use a valid identifier.", "warn"); if (!obj) return UI.toast("Select an sObject", "Pick one from the dropdown.", "warn"); await runCreate(() => app.create.createApexTrigger(name, obj), "ApexTrigger", name); } } ],
    onMount: async (root) => { root.querySelector("#tName").focus(); try { const list = await app.meta.listSObjects(); const dl = root.querySelector("#sobjList"); dl.innerHTML = list.map((s) => `<option value="${escapeHtml(s)}"></option>`).join(""); root.querySelector("#tObjHint").innerHTML = `${fmt(list.length)} objects available — type to filter.`; } catch (e) { root.querySelector("#tObjHint").textContent = "Couldn't load sObjects; type the API name manually."; } } });
}
function newVfPage() { if (!requireOrg()) return; UI.modal({ title: "New Visualforce Page", bodyHtml: `<div class="field"><label>Page name</label><input id="pName" placeholder="MyPage" autocomplete="off" /></div>`, actions: [ { label: "Cancel", kind: "ghost" }, { label: "Create", kind: "primary", keepOpen: true, onClick: async (root) => { const name = root.querySelector("#pName").value.trim(); if (!validName(name)) return UI.toast("Invalid name", "Use a valid identifier.", "warn"); await runCreate(() => app.create.createVfPage(name), "ApexPage", name); } } ], onMount: (root) => root.querySelector("#pName").focus() }); }
function newLwc() { if (!requireOrg()) return; UI.modal({ title: "New Lightning Web Component", subtitle: "Deploys a starter bundle (js, html, meta) via the Metadata API.", bodyHtml: `<div class="field"><label>Component name (camelCase)</label><input id="lName" placeholder="myComponent" autocomplete="off" /><span class="hint">LWC names must start with a lowercase letter.</span></div>`, actions: [ { label: "Cancel", kind: "ghost" }, { label: "Create", kind: "primary", keepOpen: true, onClick: async (root) => { const name = root.querySelector("#lName").value.trim(); if (!/^[a-z][A-Za-z0-9_]*$/.test(name)) return UI.toast("Invalid name", "Start with a lowercase letter.", "warn"); await runCreate(() => app.create.createLwc(name, (m) => UI.toast("Creating LWC", m, "run", 800)), "LightningComponentBundle", name); } } ], onMount: (root) => root.querySelector("#lName").focus() }); }
function newStaticResource() { if (!requireOrg()) return; UI.modal({ title: "New Static Resource", bodyHtml: `<div class="field-row"><div class="field"><label>Name</label><input id="sName" placeholder="myResource" autocomplete="off" /></div><div class="field"><label>Content type</label><input id="sType" value="text/plain" autocomplete="off" /></div></div><div class="field"><label>Initial text content (optional)</label><input id="sBody" placeholder="" autocomplete="off" /></div>`, actions: [ { label: "Cancel", kind: "ghost" }, { label: "Create", kind: "primary", keepOpen: true, onClick: async (root) => { const name = root.querySelector("#sName").value.trim(); if (!validName(name)) return UI.toast("Invalid name", "Use a valid identifier.", "warn"); const type = root.querySelector("#sType").value.trim() || "text/plain"; const text = root.querySelector("#sBody").value || ""; const b64 = btoa(unescape(encodeURIComponent(text))); await runCreate(() => app.create.createStaticResource(name, type, b64), "StaticResource", name); } } ], onMount: (root) => root.querySelector("#sName").focus() }); }
async function runCreate(fn, type, name) { UI.closeModal(); UI.toast("Creating…", name, "run", 1200); try { await fn(); await loadTree(); UI.toast("Created", `${name} added to the org.`, "ok"); await openByTypeName(type, name); } catch (e) { UI.toast("Create failed", e.message, "err", 7000); } refreshApiLimit(); }
async function openByTypeName(type, name) { const group = app.tree.find((g) => g.type === type); const node = group && group.nodes.find((n) => n.name === name); if (node) openNode(node); }

/* ============================================================ Upload */
function pickFiles({ accept = "", multiple = true, directory = false } = {}) { return new Promise((resolve) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept; inp.multiple = multiple; if (directory) { inp.webkitdirectory = true; inp.directory = true; } inp.onchange = () => resolve(Array.from(inp.files || [])); inp.click(); }); }
const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
const readBytes = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = rej; r.readAsArrayBuffer(file); });
async function uploadApexVf() { if (!requireOrg()) return; const files = await pickFiles({ accept: ".cls,.trigger,.page,.component" }); if (!files.length) return; UI.toast("Uploading…", `${files.length} file(s)`, "run", 1500); try { const entries = []; for (const f of files) entries.push({ name: f.name, text: await readText(f) }); const results = await app.create.uploadApexVf(entries, () => {}); await loadTree(); reportUpload(results); } catch (e) { UI.toast("Upload failed", e.message, "err", 7000); } refreshApiLimit(); }
async function uploadStaticResource() { if (!requireOrg()) return; const files = await pickFiles({ accept: "", multiple: false }); if (!files.length) return; const file = files[0]; const base = file.name.replace(/\.[^.]+$/, ""); const ext = (file.name.split(".").pop() || "").toLowerCase(); const type = file.type || CONTENT_TYPES[ext] || "application/octet-stream"; UI.toast("Uploading…", file.name, "run", 1500); try { const bytes = await readBytes(file); const b64 = bytesToBase64(bytes); await app.create.uploadStaticResource(base, type, b64); await loadTree(); UI.toast("Uploaded", `Static resource “${base}” created.`, "ok"); } catch (e) { UI.toast("Upload failed", e.message, "err", 7000); } refreshApiLimit(); }
async function uploadLwcFolder() { if (!requireOrg()) return; const files = await pickFiles({ directory: true }); if (!files.length) return; const top = (files[0].webkitRelativePath || files[0].name).split("/")[0]; UI.toast("Uploading LWC…", top, "run", 1800); try { const entries = []; for (const f of files) { const path = f.webkitRelativePath || f.name; const isText = /\.(js|html|css|xml|json|svg)$/i.test(f.name); entries.push({ path, data: isText ? await readText(f) : await readBytes(f) }); } await app.create.uploadLwcFolder(top, entries, () => {}); await loadTree(); UI.toast("Uploaded", `LWC “${top}” deployed.`, "ok"); await openByTypeName("LightningComponentBundle", top); } catch (e) { UI.toast("Upload failed", e.message, "err", 7000); } refreshApiLimit(); }
function reportUpload(results) { const okN = results.filter((r) => r.success).length; const bad = results.filter((r) => !r.success); if (!bad.length) return UI.toast("Uploaded", `${okN} file(s) deployed.`, "ok"); UI.modal({ title: "Upload results", bodyHtml: `<div class="console">${results.map((r) => `<div class="${r.success ? "ln-ok" : "ln-err"}">${r.success ? "✓" : "✗"} ${escapeHtml(r.name)}${r.message ? " — " + escapeHtml(r.message) : ""}</div>`).join("")}</div>`, actions: [ { label: "Close", kind: "primary" } ] }); }

/* ============================================================ Connect / OAuth */
function openConnectModal() { UI.modal({ title: "Connect with OAuth", subtitle: "OAuth 2.0 with PKCE — needs a Connected App Consumer Key. For instant access, use the 1-click option instead.", bodyHtml: `<div class="field"><label>Environment</label><div class="seg" id="envSeg"><button data-env="production" class="active">Production</button><button data-env="sandbox">Sandbox</button><button data-env="custom">My Domain</button></div></div><div class="field" id="domainField" style="display:none"><label>My Domain</label><input id="myDomain" placeholder="acme  ·  or  ·  https://acme.my.salesforce.com" /></div><div class="field"><label>Connected App — Consumer Key (Client ID)</label><input id="clientId" placeholder="3MVG9..." /><span class="hint">Setup → App Manager → New Connected App. Enable OAuth + PKCE, scopes: api, refresh_token.</span></div>`, actions: [ { label: "1-click: use open org", kind: "ghost", onClick: () => { UI.closeModal(); quickConnect(); } }, { label: "Connect with OAuth", kind: "primary", keepOpen: true, onClick: startOAuth } ], onMount: async (root) => { const cid = await store.getClientId(); if (cid) root.querySelector("#clientId").value = cid; root.querySelectorAll("#envSeg button").forEach((b) => { b.onclick = () => { root.querySelectorAll("#envSeg button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); root.querySelector("#domainField").style.display = b.dataset.env === "custom" ? "grid" : "none"; }; }); } }); }
async function startOAuth(root) { const envType = root.querySelector("#envSeg .active").dataset.env; const myDomain = root.querySelector("#myDomain").value; const clientId = root.querySelector("#clientId").value.trim(); if (!clientId) return UI.toast("Missing Client ID", "Paste your Connected App Consumer Key.", "warn"); await store.setClientId(clientId); try { UI.toast("Opening Salesforce login…", "Approve access in the popup window.", "run"); const org = await auth.loginOAuth({ envType, myDomain, clientId }); UI.closeModal(); await refreshOrgUI(); await connectToOrg(org.id); } catch (e) { UI.toast("Login failed", e.message, "err", 6000); } }

/* ============================================================ Settings */
async function openSettings() {
  const s = app.settings;
  const fontOptions = [ ["", "Default (system mono)"], ["'JetBrains Mono', monospace", "JetBrains Mono"], ["'Fira Code', monospace", "Fira Code"], ["'Cascadia Code', monospace", "Cascadia Code"], ["Menlo, monospace", "Menlo"], ["Consolas, monospace", "Consolas"], ["'Courier New', monospace", "Courier New"] ];
  UI.modal({ wide: true, title: "Settings", subtitle: "Preferences are stored locally in the extension.",
    bodyHtml: `
      <div class="field"><label>Theme</label><div class="seg" id="themeSeg"><button data-t="light" class="${s.theme === "light" ? "active" : ""}">Light</button><button data-t="dark" class="${s.theme === "dark" ? "active" : ""}">Dark</button></div></div>
      <div class="field-row"><div class="field"><label>Editor font size (px)</label><input id="setFont" type="number" min="10" max="24" value="${s.fontSize}"></div><div class="field"><label>Tab size (spaces)</label><input id="setTab" type="number" min="2" max="8" value="${s.tabSize}"></div></div>
      <div class="field-row"><div class="field"><label>Editor font family</label><select id="setFontFam">${fontOptions.map(([v, l]) => `<option value="${escapeHtml(v)}" ${s.fontFamily === v ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></div><div class="field"><label>Line height</label><select id="setLineH"><option value="1.4" ${(+s.lineHeight === 1.4) ? "selected" : ""}>Compact (1.4)</option><option value="1.6" ${(+s.lineHeight === 1.6) ? "selected" : ""}>Comfortable (1.6)</option><option value="1.8" ${(+s.lineHeight === 1.8) ? "selected" : ""}>Relaxed (1.8)</option></select></div></div>
      <div class="field-row"><div class="field"><label>Salesforce API version</label><input id="setApi" placeholder="61.0" value="${escapeHtml(s.apiVersion || "")}"><span class="hint">Blank = org default.</span></div><div class="field"><label>&nbsp;</label><label class="check-row"><input id="setWrap" type="checkbox" ${s.wordWrap ? "checked" : ""}> Word wrap</label></div></div>
      <div class="field-row"><div class="field"><label class="check-row"><input id="setAutoClose" type="checkbox" ${s.autoCloseBrackets ? "checked" : ""}> Auto-close brackets &amp; quotes</label></div><div class="field"><label class="check-row"><input id="setLineNums" type="checkbox" ${s.showLineNumbers ? "checked" : ""}> Show line numbers</label></div></div>
      <div class="field-row"><div class="field"><label class="check-row"><input id="setActive" type="checkbox" ${s.highlightActiveLine ? "checked" : ""}> Highlight the active line</label></div><div class="field"><label class="check-row"><input id="setAutosave" type="checkbox" ${s.autosaveDrafts ? "checked" : ""}> Persist open tabs between sessions</label></div></div>
      <div class="field"><label class="check-row"><input id="setProd" type="checkbox" ${s.confirmProdDeploy ? "checked" : ""}> Confirm before deploying to Production</label></div>
      <div class="sectionTitle" style="margin-top:6px;color:var(--accent)">Inspector &amp; GitHub</div>
      <div class="field-row"><div class="field"><label class="check-row"><input id="setDelConfirm" type="checkbox" ${s.confirmDeleteRecords ? "checked" : ""}> Confirm before deleting records (Inspector)</label></div><div class="field"><label class="check-row"><input id="setQueryAll" type="checkbox" ${s.defaultQueryAll ? "checked" : ""}> Default \u201cQuery all pages\u201d on</label></div></div>
      <div class="field"><label class="check-row"><input id="setAutoPush" type="checkbox" ${s.githubAutoPush ? "checked" : ""}> Auto-push the active file to GitHub after a successful deploy</label></div>
      <div class="warn-box">Font family, line-height, line-numbers, word-wrap and API-version changes apply to files you open/reopen after saving.</div>`,
    actions: [ { label: "Reset to defaults", kind: "ghost", keepOpen: true, onClick: async () => { app.settings = await store.resetSettings(); applyTheme(app.settings.theme); applyEditorPrefs(); UI.closeModal(); UI.toast("Settings reset", "", "ok"); } }, { label: "Cancel", kind: "ghost" }, { label: "Save", kind: "primary", keepOpen: true, onClick: async (root) => { const theme = root.querySelector("#themeSeg .active").dataset.t; app.settings = await store.saveSettings({ theme, fontSize: +root.querySelector("#setFont").value || 13, tabSize: +root.querySelector("#setTab").value || 4, fontFamily: root.querySelector("#setFontFam").value, lineHeight: +root.querySelector("#setLineH").value || 1.6, apiVersion: root.querySelector("#setApi").value.trim(), wordWrap: root.querySelector("#setWrap").checked, autoCloseBrackets: root.querySelector("#setAutoClose").checked, showLineNumbers: root.querySelector("#setLineNums").checked, highlightActiveLine: root.querySelector("#setActive").checked, confirmProdDeploy: root.querySelector("#setProd").checked, autosaveDrafts: root.querySelector("#setAutosave").checked, confirmDeleteRecords: root.querySelector("#setDelConfirm").checked, defaultQueryAll: root.querySelector("#setQueryAll").checked, githubAutoPush: root.querySelector("#setAutoPush").checked }); applyTheme(theme); applyEditorPrefs(); if (app.client && app.settings.apiVersion) { app.client.apiVersion = app.settings.apiVersion; updateOrgHeader(); } UI.closeModal(); UI.toast("Settings saved", "", "ok"); } } ],
    onMount: (root) => { root.querySelectorAll("#themeSeg button").forEach((b) => (b.onclick = () => { root.querySelectorAll("#themeSeg button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); applyTheme(b.dataset.t); })); } });
}

/* ============================================================ helpers */
function toggleTheme() { const next = app.settings.theme === "dark" ? "light" : "dark"; app.settings.theme = next; applyTheme(next); store.saveSettings({ theme: next }).then((s) => (app.settings = s)); }
function applyTheme(theme) { document.documentElement.setAttribute("data-theme", theme); $("#themeBtn").innerHTML = theme === "dark" ? Icons.sun : Icons.moon; }
function applyEditorPrefs() { const r = document.documentElement.style; r.setProperty("--editor-font-size", (app.settings.fontSize || 13) + "px"); if (app.settings.fontFamily) r.setProperty("--font-mono", app.settings.fontFamily); else r.removeProperty("--font-mono"); }
async function refreshApiLimit() { const el = $("#apiLimit"); if (app.client && app.client.limitInfo) { const { used, total } = app.client.limitInfo; el.innerHTML = `API <b>${fmt(used)}</b>/${fmt(total)}`; return; } try { const l = await app.client.limits(); const d = l.DailyApiRequests; el.innerHTML = `API <b>${fmt(d.Max - d.Remaining)}</b>/${fmt(d.Max)}`; } catch (_) {} }
function setStatusCursor(line, column) { $("#statusPos").textContent = `Ln ${line}, Col ${column}`; }
function iconForFile(file) { if (!file) return Icons.file; const map = { apex: "class", javascript: "js", html: "html", css: "css", xml: "xml" }; return Icons[map[file.language]] || Icons.file; }
function shortHost(url) { try { return new URL(url).hostname.replace(".my.salesforce.com", "").replace(".salesforce.com", ""); } catch { return url; } }
function downloadFile(name, content, type) { const blob = new Blob([content], { type }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
async function persistTabs() { if (!app.org || !app.settings.autosaveDrafts) return; await store.saveOpenTabs(app.org.id, app.tabs.map((t) => ({ type: t.node.type, id: t.node.id, name: t.node.name }))); }
async function restoreTabs() { if (!app.settings.autosaveDrafts) return; const saved = await store.getOpenTabs(app.org.id); for (const s of saved.slice(0, 8)) { const group = app.tree.find((g) => g.type === s.type); const node = group && group.nodes.find((n) => n.id === s.id); if (node) await openNode(node); } }
function wireResizers() { const wb = $(".workbench"); makeDrag($(".col-resize"), (dx) => { const cur = parseInt(getComputedStyle(wb).getPropertyValue("--sidebar-w")) || 264; wb.style.setProperty("--sidebar-w", Math.max(180, Math.min(480, cur + dx)) + "px"); }, "x"); makeDrag($(".row-resize"), (dy) => { if (wb.classList.contains("panel-collapsed")) return; const cur = parseInt(getComputedStyle(wb).getPropertyValue("--panel-h")) || 240; const next = Math.max(120, Math.min(560, cur - dy)); wb.style.setProperty("--panel-h", next + "px"); app.lastPanelH = next; }, "y"); }
function makeDrag(handle, onMove, axis) { if (!handle) return; handle.addEventListener("mousedown", (e) => { e.preventDefault(); let last = axis === "x" ? e.clientX : e.clientY; const move = (ev) => { const p = axis === "x" ? ev.clientX : ev.clientY; onMove(p - last); last = p; }; const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.userSelect = ""; }; document.body.style.userSelect = "none"; document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); }); }
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { const t = activeTab(); if (t) { e.preventDefault(); deployActive(); } } });
init();

/* github.js — GitHub REST integration for OrgStudio.
   One-click version control: sign in with a Personal Access Token, then
   pull repo files into the editor and push (commit) all of your Salesforce
   code back to a repo/branch in a single commit using the Git Data API. */
import { GITHUB_API } from "../common/constants.js";
import * as store from "./storage.js";

function b64(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); }
function fromB64(str) { try { const bin = atob((str || "").replace(/\n/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); } catch { return ""; } }

export class GitHub {
  constructor(cfg) { this.cfg = cfg || {}; }
  static async load() { return new GitHub(await store.getGithub()); }
  get connected() { return !!(this.cfg && this.cfg.token && this.cfg.owner && this.cfg.repo); }
  headers(extra = {}) { return { Authorization: `Bearer ${this.cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...extra }; }
  async api(path, { method = "GET", body, raw = false } = {}) {
    const url = /^https?:\/\//.test(path) ? path : `${GITHUB_API}${path}`;
    const res = await fetch(url, { method, headers: this.headers(body ? { "Content-Type": "application/json" } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    if (raw) return res;
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) { const msg = (json && json.message) || `GitHub API error ${res.status}`; const err = new Error(msg); err.status = res.status; err.body = json; throw err; }
    return json;
  }
  async verify(token) { const res = await fetch(`${GITHUB_API}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }); if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || `Token rejected (${res.status}). Check scopes: repo.`); } return res.json(); }
  async listRepos() { const out = []; for (let page = 1; page <= 4; page++) { const list = await this.api(`/user/repos?per_page=100&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`); if (!list.length) break; out.push(...list); if (list.length < 100) break; } return out; }
  repoBase() { return `/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`; }
  joinPath(p) { const base = (this.cfg.basePath || "").replace(/^\/+|\/+$/g, ""); const rel = (p || "").replace(/^\/+/, ""); return base ? `${base}/${rel}` : rel; }
  async getRepoInfo() { return this.api(this.repoBase()); }
  async defaultBranch() { try { const info = await this.getRepoInfo(); return info.default_branch || "main"; } catch { return "main"; } }
  async getRef(branch) { try { return await this.api(`${this.repoBase()}/git/ref/heads/${encodeURIComponent(branch)}`); } catch (e) { if (e.status === 404) return null; throw e; } }
  async listTree(branch) {
    const ref = await this.getRef(branch);
    if (!ref) return { sha: null, files: [] };
    const commitSha = ref.object.sha;
    const commit = await this.api(`${this.repoBase()}/git/commits/${commitSha}`);
    const tree = await this.api(`${this.repoBase()}/git/trees/${commit.tree.sha}?recursive=1`);
    const base = (this.cfg.basePath || "").replace(/^\/+|\/+$/g, "");
    const files = (tree.tree || []).filter((t) => t.type === "blob" && (!base || t.path.startsWith(base + "/") || t.path === base)).map((t) => ({ path: t.path, sha: t.sha, size: t.size }));
    return { sha: commitSha, treeSha: commit.tree.sha, files };
  }
  async getBlob(sha) { const b = await this.api(`${this.repoBase()}/git/blobs/${sha}`); return b.encoding === "base64" ? fromB64(b.content) : b.content; }
  async ensureBranch(branch) {
    let ref = await this.getRef(branch);
    if (ref) return ref;
    const def = await this.defaultBranch();
    const defRef = await this.getRef(def);
    if (!defRef) throw new Error(`Repository has no commits yet. Create an initial commit on GitHub, then retry.`);
    await this.api(`${this.repoBase()}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: defRef.object.sha } });
    return this.getRef(branch);
  }
  async commitFiles(files, message, onProgress = () => {}) {
    if (!files.length) throw new Error("No files to push.");
    const branch = this.cfg.branch || "main";
    onProgress(`Resolving branch “${branch}”…`);
    const ref = await this.ensureBranch(branch);
    const latestCommitSha = ref.object.sha;
    const baseCommit = await this.api(`${this.repoBase()}/git/commits/${latestCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;
    const treeItems = [];
    let i = 0;
    for (const f of files) {
      i++; onProgress(`Uploading blob ${i}/${files.length}: ${f.path}`);
      const blob = await this.api(`${this.repoBase()}/git/blobs`, { method: "POST", body: { content: b64(f.content ?? ""), encoding: "base64" } });
      treeItems.push({ path: this.joinPath(f.path), mode: "100644", type: "blob", sha: blob.sha });
    }
    onProgress("Creating tree…");
    const newTree = await this.api(`${this.repoBase()}/git/trees`, { method: "POST", body: { base_tree: baseTreeSha, tree: treeItems } });
    onProgress("Creating commit…");
    const commit = await this.api(`${this.repoBase()}/git/commits`, { method: "POST", body: { message: message || `OrgStudio sync ${new Date().toISOString()}`, tree: newTree.sha, parents: [latestCommitSha] } });
    onProgress("Updating branch ref…");
    await this.api(`${this.repoBase()}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
    return { commitSha: commit.sha, count: files.length, url: `https://github.com/${this.cfg.owner}/${this.cfg.repo}/commit/${commit.sha}`, branch };
  }
}

export function repoPathFor(node, file) {
  const type = node.type; const name = node.name;
  switch (type) {
    case "ApexClass": return `classes/${name}.cls`;
    case "ApexTrigger": return `triggers/${name}.trigger`;
    case "ApexPage": return `pages/${name}.page`;
    case "ApexComponent": return `components/${name}.component`;
    case "LightningComponentBundle": return `lwc/${name}/${file.name}`;
    case "AuraDefinitionBundle": return `aura/${name}/${file.name}`;
    case "StaticResource": return `staticresources/${file.name}`;
    default: return `${type}/${file.name}`;
  }
}

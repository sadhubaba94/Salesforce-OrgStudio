import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "../common/constants.js";
import { sleep } from "../common/util.js";
import * as store from "./storage.js";
const MEMBER_OBJECT = { ApexClass: "ApexClassMember", ApexTrigger: "ApexTriggerMember", ApexPage: "ApexPageMember", ApexComponent: "ApexComponentMember" };
export class DeployEngine {
  constructor(client) { this.client = client; }
  async saveApex(files, onProgress = () => {}) {
    for (const f of files) await store.saveSnapshot(this.client.org.id, f.key, f.name, f.body);
    onProgress("Creating metadata container…");
    const container = await this.client.toolingCreate("MetadataContainer", { Name: `OrgStudio_${Date.now()}` });
    if (!container.success) throw new Error("Failed to create MetadataContainer.");
    const containerId = container.id;
    try {
      onProgress("Staging members…");
      for (const f of files) { const memberObj = MEMBER_OBJECT[f.memberType]; if (!memberObj) throw new Error(`Unsupported member type: ${f.memberType}`); const created = await this.client.toolingCreate(memberObj, { MetadataContainerId: containerId, ContentEntityId: f.recordId, Body: f.body }); if (!created.success) throw new Error(`Failed to stage ${f.name}: ${JSON.stringify(created.errors)}`); }
      onProgress("Submitting compile/deploy request…");
      const asyncReq = await this.client.toolingCreate("ContainerAsyncRequest", { IsCheckOnly: false, MetadataContainerId: containerId });
      if (!asyncReq.success) throw new Error("Failed to create ContainerAsyncRequest.");
      return await this._pollContainer(asyncReq.id, onProgress);
    } finally { this.client.toolingDelete("MetadataContainer", containerId).catch(() => {}); }
  }
  async _pollContainer(requestId, onProgress) {
    const start = Date.now();
    while (true) {
      const { records } = await this.client.toolingQuery(`SELECT Id, State, DeployDetails, ErrorMsg FROM ContainerAsyncRequest WHERE Id = '${requestId}'`);
      const rec = records[0]; const state = rec ? rec.State : "Unknown"; onProgress(`Compile status: ${state}…`);
      if (state === "Completed") return { success: true, state, errors: [] };
      if (["Failed", "Error", "Aborted"].includes(state)) return { success: false, state, message: rec.ErrorMsg, errors: this._parseFailures(rec) };
      if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error("Timed out waiting for compile/deploy.");
      await sleep(POLL_INTERVAL_MS);
    }
  }
  _parseFailures(rec) { const failures = (rec && rec.DeployDetails && rec.DeployDetails.componentFailures) || []; return failures.map((f) => ({ file: f.fullName || f.fileName, line: f.lineNumber != null ? Number(f.lineNumber) : null, column: f.columnNumber != null ? Number(f.columnNumber) : null, problem: f.problem, type: f.problemType || "Error" })); }
  async saveLwcResource(file, onProgress = () => {}) { await store.saveSnapshot(this.client.org.id, file.key, file.name, file.body); onProgress("Updating LWC resource…"); const res = await this.client.toolingUpdate("LightningComponentResource", file.recordId, { Source: file.body }); return { success: true, state: "Completed", raw: res, errors: [] }; }
  async saveAuraDefinition(file, onProgress = () => {}) { await store.saveSnapshot(this.client.org.id, file.key, file.name, file.body); onProgress("Updating Aura definition…"); const res = await this.client.toolingUpdate("AuraDefinition", file.recordId, { Source: file.body }); return { success: true, state: "Completed", raw: res, errors: [] }; }
  async revert(fileKey, snapshotId) { const snaps = await store.getSnapshots(this.client.org.id, fileKey); const snap = snaps.find((s) => s.id === snapshotId); if (!snap) throw new Error("Snapshot not found."); return snap.content; }
}

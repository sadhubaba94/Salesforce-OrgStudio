import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "../common/constants.js";
import { sleep } from "../common/util.js";
export class DevTools {
  constructor(client) { this.client = client; }
  async executeAnonymous(apex) {
    await this._ensureTraceFlag().catch(() => {});
    const before = await this._latestLogId();
    const res = await this.client.executeAnonymous(apex);
    let log = "";
    if (res.compiled && res.success) log = await this._waitForNewLog(before);
    else log = res.compileProblem ? `Compile error (line ${res.line}, col ${res.column}): ${res.compileProblem}` : (res.exceptionMessage || "") + "\n" + (res.exceptionStackTrace || "");
    return { compiled: res.compiled, success: res.success, line: res.line, column: res.column, message: res.compileProblem || res.exceptionMessage || (res.success ? "Success" : "Failed"), log, raw: res };
  }
  async runTests(tests, onProgress = () => {}) {
    const body = { tests: tests.map((t) => ({ classId: t.classId, className: t.className, testMethods: t.testMethods && t.testMethods.length ? t.testMethods : undefined })) };
    onProgress("Enqueuing test run…");
    const jobId = await this.client.request(`/services/data/v${this.client.apiVersion}/tooling/runTestsAsynchronous/`, { method: "POST", body });
    const jid = typeof jobId === "string" ? jobId.replace(/"/g, "") : jobId;
    const start = Date.now();
    while (true) { const { records } = await this.client.toolingQuery(`SELECT Id, Status FROM ApexTestQueueItem WHERE ParentJobId = '${jid}'`); const statuses = records.map((r) => r.Status); const done = statuses.every((s) => ["Completed", "Failed", "Aborted"].includes(s)); onProgress(`Tests: ${statuses.filter((s) => s === "Completed").length}/${statuses.length} done…`); if (done && records.length) break; if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error("Test run timed out."); await sleep(POLL_INTERVAL_MS); }
    const { records: results } = await this.client.toolingQuery(`SELECT Id, Outcome, MethodName, Message, ApexClass.Name, RunTime FROM ApexTestResult WHERE AsyncApexJobId = '${jid}' ORDER BY ApexClass.Name`, { all: true });
    const coverage = await this._coverage().catch(() => []);
    return { jobId: jid, summary: { total: results.length, passed: results.filter((r) => r.Outcome === "Pass").length, failed: results.filter((r) => r.Outcome === "Fail").length }, results, coverage };
  }
  async _coverage() { const { records } = await this.client.toolingQuery(`SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate ORDER BY ApexClassOrTrigger.Name`, { all: true }); return records.map((r) => { const total = (r.NumLinesCovered || 0) + (r.NumLinesUncovered || 0); return { name: r.ApexClassOrTrigger && r.ApexClassOrTrigger.Name, covered: r.NumLinesCovered || 0, total, percent: total ? Math.round((r.NumLinesCovered / total) * 100) : 0 }; }); }
  async _ensureTraceFlag() { const userId = await this._currentUserId(); const nowIso = new Date().toISOString(); const { records } = await this.client.toolingQuery(`SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 1`); if (records[0] && records[0].ExpirationDate > nowIso) return records[0].Id; const dl = await this._ensureDebugLevel(); const created = await this.client.toolingCreate("TraceFlag", { TracedEntityId: userId, LogType: "USER_DEBUG", DebugLevelId: dl, StartDate: nowIso, ExpirationDate: new Date(Date.now() + 3600000).toISOString() }); return created.id; }
  async _ensureDebugLevel() { const { records } = await this.client.toolingQuery(`SELECT Id FROM DebugLevel WHERE DeveloperName = 'OrgStudio_Debug' LIMIT 1`); if (records[0]) return records[0].Id; const created = await this.client.toolingCreate("DebugLevel", { DeveloperName: "OrgStudio_Debug", MasterLabel: "OrgStudio Debug", ApexCode: "DEBUG", ApexProfiling: "INFO", Callout: "INFO", Database: "INFO", System: "DEBUG", Validation: "INFO", Visualforce: "INFO", Workflow: "INFO" }); return created.id; }
  async listLogs(limit = 25) { const { records } = await this.client.toolingQuery(`SELECT Id, LogUser.Name, Operation, Application, Status, LogLength, StartTime, DurationMilliseconds FROM ApexLog ORDER BY StartTime DESC LIMIT ${limit}`); return records; }
  async getLogBody(logId) { const res = await this.client.request(`/services/data/v${this.client.apiVersion}/tooling/sobjects/ApexLog/${logId}/Body`, { raw: true }); return res.text(); }
  async _currentUserId() { if (this._userId) return this._userId; try { const { records } = await this.client.query(`SELECT Id FROM User WHERE Username = '${this.client.org.username.replace(/'/g, "\\'")}' LIMIT 1`); if (records[0]) return (this._userId = records[0].Id); } catch (_) {} const me = await this.client.request(`/services/data/v${this.client.apiVersion}/chatter/users/me`); return (this._userId = me.id); }
  async _latestLogId() { try { const { records } = await this.client.toolingQuery(`SELECT Id FROM ApexLog ORDER BY StartTime DESC LIMIT 1`); return records[0] ? records[0].Id : null; } catch (_) { return null; } }
  async _waitForNewLog(beforeId) { for (let i = 0; i < 8; i++) { await sleep(700); const id = await this._latestLogId(); if (id && id !== beforeId) return this.getLogBody(id).catch(() => ""); } return ""; }
}

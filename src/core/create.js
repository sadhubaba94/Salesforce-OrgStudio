import { API_VERSION, POLL_TIMEOUT_MS } from "../common/constants.js";
import { sleep, bytesToBase64, utf8ToBase64 } from "../common/util.js";
import { buildZip, zipToBase64 } from "./zip.js";
const VALID_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
export function validName(name) { return VALID_NAME.test(name || ""); }
export class CreateService {
  constructor(client) { this.client = client; this.v = client.apiVersion || API_VERSION; }
  classTemplate(n) { return `public with sharing class ${n} {\n    public ${n}() {\n\n    }\n}`; }
  triggerTemplate(n, obj) { return `trigger ${n} on ${obj} (before insert) {\n\n}`; }
  vfPageTemplate(n) { return `<apex:page>\n    <h1>${n}</h1>\n</apex:page>`; }
  vfComponentTemplate(n) { return `<apex:component>\n    <h1>${n}</h1>\n</apex:component>`; }
  lwcJs(n) { return `import { LightningElement } from 'lwc';\n\nexport default class ${cap(n)} extends LightningElement {}`; }
  lwcHtml() { return `<template>\n    \n</template>`; }
  lwcMeta(n) { return `<?xml version="1.0" encoding="UTF-8"?>\n<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${this.v}</apiVersion>\n    <isExposed>false</isExposed>\n    <masterLabel>${n}</masterLabel>\n</LightningComponentBundle>`; }
  async createApexClass(name, body) { const r = await this.client.toolingCreate("ApexClass", { Body: body || this.classTemplate(name) }); if (!r.success) throw new Error(errs(r)); return { id: r.id, type: "ApexClass", name }; }
  async createApexTrigger(name, sobject, body) { const r = await this.client.toolingCreate("ApexTrigger", { Name: name, TableEnumOrId: sobject, Body: body || this.triggerTemplate(name, sobject) }); if (!r.success) throw new Error(errs(r)); return { id: r.id, type: "ApexTrigger", name }; }
  async createVfPage(name, markup) { const r = await this.client.toolingCreate("ApexPage", { Name: name, MasterLabel: name, Markup: markup || this.vfPageTemplate(name) }); if (!r.success) throw new Error(errs(r)); return { id: r.id, type: "ApexPage", name }; }
  async createVfComponent(name, markup) { const r = await this.client.toolingCreate("ApexComponent", { Name: name, MasterLabel: name, Markup: markup || this.vfComponentTemplate(name) }); if (!r.success) throw new Error(errs(r)); return { id: r.id, type: "ApexComponent", name }; }
  async createStaticResource(name, contentType, base64Body) { const r = await this.client.toolingCreate("StaticResource", { Name: name, ContentType: contentType || "text/plain", CacheControl: "Public", Body: base64Body ?? utf8ToBase64("") }); if (!r.success) throw new Error(errs(r)); return { id: r.id, type: "StaticResource", name }; }
  async createLwc(name, onProgress = () => {}) {
    const dir = `lwc/${name}`;
    const files = [ { name: "package.xml", data: pkgXml(name, "LightningComponentBundle", this.v) }, { name: `${dir}/${name}.js`, data: this.lwcJs(name) }, { name: `${dir}/${name}.html`, data: this.lwcHtml() }, { name: `${dir}/${name}.js-meta.xml`, data: this.lwcMeta(name) } ];
    await this.deployZip(files, onProgress); return { type: "LightningComponentBundle", name };
  }
  async uploadApexVf(fileEntries, onProgress = () => {}) {
    const out = [];
    for (const fe of fileEntries) {
      const base = fe.name.replace(/\.[^.]+$/, ""); const ext = (fe.name.split(".").pop() || "").toLowerCase();
      onProgress(`Uploading ${fe.name}…`);
      try {
        if (ext === "cls") { await this.createApexClass(base, fe.text); out.push(ok(fe.name)); }
        else if (ext === "trigger") { const obj = (/on\s+(\w+)/i.exec(fe.text) || [])[1] || "Account"; await this.createApexTrigger(base, obj, fe.text); out.push(ok(fe.name)); }
        else if (ext === "page") { await this.createVfPage(base, fe.text); out.push(ok(fe.name)); }
        else if (ext === "component") { await this.createVfComponent(base, fe.text); out.push(ok(fe.name)); }
        else out.push(fail(fe.name, `Unsupported type .${ext}`));
      } catch (e) { out.push(fail(fe.name, e.message)); }
    }
    return out;
  }
  async uploadStaticResource(name, contentType, base64Body) { await this.createStaticResource(name, contentType, base64Body); return [ok(name)]; }
  async uploadLwcFolder(bundleName, fileEntries, onProgress = () => {}) {
    const zipFiles = [{ name: "package.xml", data: pkgXml(bundleName, "LightningComponentBundle", this.v) }];
    let hasMeta = false;
    for (const fe of fileEntries) { const rel = fe.path.split("/").slice(1).join("/") || fe.path.split("/").pop(); if (/js-meta\.xml$/i.test(rel)) hasMeta = true; zipFiles.push({ name: `lwc/${bundleName}/${rel}`, data: fe.data }); }
    if (!hasMeta) zipFiles.push({ name: `lwc/${bundleName}/${bundleName}.js-meta.xml`, data: this.lwcMeta(bundleName) });
    await this.deployZip(zipFiles, onProgress); return [ok(bundleName)];
  }
  async deployZip(files, onProgress = () => {}) {
    onProgress("Packaging…"); const b64 = zipToBase64(buildZip(files)); onProgress("Submitting Metadata deploy…");
    const inner = `<met:deploy><met:ZipFile>${b64}</met:ZipFile><met:DeployOptions><met:singlePackage>true</met:singlePackage><met:rollbackOnError>true</met:rollbackOnError></met:DeployOptions></met:deploy>`;
    const xml = await this.client.metadataSoap("deploy", inner);
    const id = (/<id>([^<]+)<\/id>/.exec(xml) || [])[1];
    if (!id) throw new Error("Deploy did not return an id.");
    const start = Date.now();
    while (true) {
      const status = await this.client.metadataSoap("checkDeployStatus", `<met:checkDeployStatus><met:asyncProcessId>${id}</met:asyncProcessId><met:includeDetails>true</met:includeDetails></met:checkDeployStatus>`);
      onProgress("Deploying…");
      if (/<done>true<\/done>/.test(status)) { if (/<success>true<\/success>/.test(status)) return { success: true }; const problem = (/<problem>([\s\S]*?)<\/problem>/.exec(status) || [])[1] || (/<errorMessage>([\s\S]*?)<\/errorMessage>/.exec(status) || [])[1] || "Deploy failed."; throw new Error(problem); }
      if (Date.now() - start > POLL_TIMEOUT_MS) throw new Error("Deploy timed out.");
      await sleep(1300);
    }
  }
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function errs(r) { return (r.errors && r.errors.map((e) => e.message || e).join("; ")) || "Create failed."; }
function ok(name) { return { name, success: true }; }
function fail(name, message) { return { name, success: false, message }; }
function pkgXml(member, type, v) { return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n    <types><members>${member}</members><name>${type}</name></types>\n    <version>${v}</version>\n</Package>`; }
export const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", js: "application/javascript", css: "text/css", json: "application/json", zip: "application/zip", txt: "text/plain", csv: "text/csv", html: "text/html", xml: "application/xml", woff: "font/woff", woff2: "font/woff2" };

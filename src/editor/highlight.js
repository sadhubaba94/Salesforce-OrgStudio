const APEX_KW = new Set(("abstract and as asc autonomous begin break bulk by case cast catch class commit const continue decimal default delete desc do else end enum exception exit extends false final finally for from future get global goto group having if implements import in inner insert instanceof interface into join like limit list long loop map merge new not null nulls object of on or order outer override package parallel private protected public retrieve return rollback savepoint search select set short sort super switch synchronized system testmethod then this throw today tolabel transaction trigger true try type undelete union update upsert using virtual void webservice when where while sharing without with").split(/\s+/));
const APEX_TYPES = new Set(("Integer String Boolean Decimal Double Long Date Datetime Time Id Blob Object List Set Map SObject Database Schema System Test Trigger ApexPages PageReference Http HttpRequest HttpResponse JSON").split(/\s+/));
const JS_KW = new Set(("await async break case catch class const continue debugger default delete do else export extends false finally for from function get if implements import in instanceof let new null of return set static super switch this throw true try typeof var void while with yield").split(/\s+/));
const CSS_KW = new Set("important inherit initial unset none auto flex grid block inline".split(/\s+/));
function generic(line, kw, types, state) {
  const t = []; let i = 0; const n = line.length;
  if (state.inBlockComment) { const e = line.indexOf("*/"); if (e === -1) { t.push({ text: line, type: "comment" }); return { tokens: t, state }; } t.push({ text: line.slice(0, e + 2), type: "comment" }); i = e + 2; state = { ...state, inBlockComment: false }; }
  while (i < n) { const c = line[i], rest = line.slice(i);
    if (rest.startsWith("//")) { t.push({ text: rest, type: "comment" }); break; }
    if (rest.startsWith("/*")) { const e = line.indexOf("*/", i + 2); if (e === -1) { t.push({ text: line.slice(i), type: "comment" }); state = { ...state, inBlockComment: true }; break; } t.push({ text: line.slice(i, e + 2), type: "comment" }); i = e + 2; continue; }
    if (c === '"' || c === "'" || c === "`") { let j = i + 1; while (j < n && line[j] !== c) { if (line[j] === "\\") j++; j++; } t.push({ text: line.slice(i, Math.min(j + 1, n)), type: "string" }); i = j + 1; continue; }
    if (/[0-9]/.test(c)) { const m = /^[0-9][0-9._a-fx]*/.exec(rest); t.push({ text: m[0], type: "number" }); i += m[0].length; continue; }
    if (/[A-Za-z_$@]/.test(c)) { const m = /^[A-Za-z0-9_$@]+/.exec(rest); const w = m[0]; let ty = "ident"; if (w.startsWith("@")) ty = "annotation"; else if (kw.has(w.toLowerCase()) || kw.has(w)) ty = "keyword"; else if (types.has(w) || /^[A-Z]/.test(w)) ty = "type"; t.push({ text: w, type: ty }); i += w.length; continue; }
    const pm = /^[{}()[\].,;:?]|^[+\-*/%=&|<>!~^]+/.exec(rest); if (pm) { t.push({ text: pm[0], type: "punct" }); i += pm[0].length; continue; }
    const wm = /^\s+/.exec(rest); if (wm) { t.push({ text: wm[0], type: "plain" }); i += wm[0].length; continue; }
    t.push({ text: c, type: "plain" }); i++;
  }
  return { tokens: t, state };
}
function css(line, state) {
  const t = []; let i = 0; const n = line.length;
  if (state.inBlockComment) { const e = line.indexOf("*/"); if (e === -1) return { tokens: [{ text: line, type: "comment" }], state }; t.push({ text: line.slice(0, e + 2), type: "comment" }); i = e + 2; state = { ...state, inBlockComment: false }; }
  while (i < n) { const rest = line.slice(i);
    if (rest.startsWith("/*")) { const e = line.indexOf("*/", i + 2); if (e === -1) { t.push({ text: rest, type: "comment" }); state = { ...state, inBlockComment: true }; break; } t.push({ text: line.slice(i, e + 2), type: "comment" }); i = e + 2; continue; }
    const m = /^[.#]?[-A-Za-z0-9_]+/.exec(rest); if (m) { let ty = "ident"; if (m[0].startsWith(".") || m[0].startsWith("#")) ty = "type"; else if (CSS_KW.has(m[0])) ty = "keyword"; t.push({ text: m[0], type: ty }); i += m[0].length; continue; }
    const s = /^["'][^"']*["']/.exec(rest); if (s) { t.push({ text: s[0], type: "string" }); i += s[0].length; continue; }
    const p = /^[{}();:,]/.exec(rest); if (p) { t.push({ text: p[0], type: "punct" }); i++; continue; }
    t.push({ text: rest[0], type: "plain" }); i++;
  }
  return { tokens: t, state };
}
function markup(line, state) {
  const t = []; let i = 0; const n = line.length;
  if (state.inComment) { const e = line.indexOf("-->"); if (e === -1) return { tokens: [{ text: line, type: "comment" }], state }; t.push({ text: line.slice(0, e + 3), type: "comment" }); i = e + 3; state = { ...state, inComment: false }; }
  while (i < n) { const rest = line.slice(i);
    if (rest.startsWith("<!--")) { const e = line.indexOf("-->", i + 4); if (e === -1) { t.push({ text: rest, type: "comment" }); state = { ...state, inComment: true }; break; } t.push({ text: line.slice(i, e + 3), type: "comment" }); i = e + 3; continue; }
    if (rest[0] === "<") { const m = /^<\/?[A-Za-z][\w:.-]*/.exec(rest); if (m) { t.push({ text: m[0], type: "type" }); i += m[0].length; continue; } t.push({ text: "<", type: "punct" }); i++; continue; }
    if (rest[0] === ">" || rest[0] === "/") { t.push({ text: rest[0], type: "punct" }); i++; continue; }
    const str = /^["'][^"']*["']/.exec(rest); if (str) { t.push({ text: str[0], type: "string" }); i += str[0].length; continue; }
    const attr = /^[A-Za-z_:][\w:.-]*(?==)/.exec(rest); if (attr) { t.push({ text: attr[0], type: "annotation" }); i += attr[0].length; continue; }
    const other = /^[^<>"']+/.exec(rest); if (other) { t.push({ text: other[0], type: "plain" }); i += other[0].length; continue; }
    t.push({ text: rest[0], type: "plain" }); i++;
  }
  return { tokens: t, state };
}
export function tokenizeLine(line, language, state = {}) {
  switch (language) { case "apex": return generic(line, APEX_KW, APEX_TYPES, state); case "javascript": return generic(line, JS_KW, new Set(), state); case "css": return css(line, state); case "html": case "xml": return markup(line, state); default: return { tokens: [{ text: line, type: "plain" }], state }; }
}

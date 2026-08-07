import { tokenizeLine } from "./highlight.js";
import { escapeHtml, debounce } from "../common/util.js";
export class CodeEditor {
  constructor(mount, { language = "text", value = "", tabSize = 4, wordWrap = false, autoCloseBrackets = true, lineHeight = 1.6, lineNumbers = true, onChange } = {}) {
    this.language = language; this.tabSize = tabSize; this.autoClose = autoCloseBrackets; this.onChangeCb = onChange; this.errors = [];
    this.lhMul = +lineHeight || 1.6;
    this.root = document.createElement("div"); this.root.className = "ce-root" + (wordWrap ? " ce-wrap" : "") + (lineNumbers ? "" : " ce-no-gutter");
    this.root.innerHTML = `<div class="ce-gutter" aria-hidden="true"></div><div class="ce-scroll"><pre class="ce-highlight" aria-hidden="true"><code></code></pre><textarea class="ce-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="${wordWrap ? "soft" : "off"}"></textarea></div>`;
    mount.appendChild(this.root);
    this.gutter = this.root.querySelector(".ce-gutter"); this.highlight = this.root.querySelector(".ce-highlight code"); this.input = this.root.querySelector(".ce-input");
    this.input.value = value; this._pristine = value; this._render = debounce(() => this._paint(), 16); this._bind();
    this._syncLineMetrics(); this._paint();
    if (typeof ResizeObserver !== "undefined") { this._ro = new ResizeObserver(() => this._syncLineMetrics()); this._ro.observe(this.input); }
  }
  _syncLineMetrics() {
    const cs = getComputedStyle(this.input);
    const fs = parseFloat(cs.fontSize) || 13;
    const lh = Math.max(1, Math.round(fs * (this.lhMul || 1.6)));
    this._lh = lh;
    this.root.style.setProperty("--ce-line-height", lh + "px");
  }
  _bind() {
    this.input.addEventListener("input", () => { this._paint(); this._emit(); });
    this.input.addEventListener("scroll", () => { this.highlight.parentElement.scrollTop = this.input.scrollTop; this.highlight.parentElement.scrollLeft = this.input.scrollLeft; this.gutter.scrollTop = this.input.scrollTop; });
    this.input.addEventListener("keydown", (e) => this._onKey(e));
    this.input.addEventListener("click", () => this._paintActiveLine());
    this.input.addEventListener("keyup", () => this._paintActiveLine());
  }
  _onKey(e) {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); this._fire("save"); return; }
    if (meta && e.key.toLowerCase() === "f") { e.preventDefault(); this._fire("find"); return; }
    if (meta && e.key.toLowerCase() === "h") { e.preventDefault(); this._fire("replace"); return; }
    if (e.key === "Tab") { e.preventDefault(); this._insertIndent(e.shiftKey); return; }
    if (this.autoClose) { const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" }; if (pairs[e.key] && this.input.selectionStart === this.input.selectionEnd) { e.preventDefault(); this._wrapInsert(e.key, pairs[e.key]); return; } }
    if (e.key === "Enter") { e.preventDefault(); this._smartEnter(); return; }
  }
  _insertIndent(outdent) { const sp = " ".repeat(this.tabSize); const { selectionStart: s, selectionEnd: e, value } = this.input; if (s === e && !outdent) this._replaceRange(s, e, sp, s + sp.length); else { const ls = value.lastIndexOf("\n", s - 1) + 1; const block = value.slice(ls, e); const changed = outdent ? block.replace(new RegExp(`^( {1,${this.tabSize}}|\t)`, "gm"), "") : block.replace(/^/gm, sp); this._replaceRange(ls, e, changed, ls + changed.length); } this._paint(); this._emit(); }
  _wrapInsert(open, close) { const { selectionStart: s, selectionEnd: e, value } = this.input; const sel = value.slice(s, e); this._replaceRange(s, e, open + sel + close, sel ? s + 1 : s + 1); if (!sel) this.input.selectionStart = this.input.selectionEnd = s + 1; this._paint(); this._emit(); }
  _smartEnter() { const { selectionStart: s, value } = this.input; const ls = value.lastIndexOf("\n", s - 1) + 1; const line = value.slice(ls, s); const indent = (line.match(/^\s*/) || [""])[0]; const extra = /[{([]\s*$/.test(line) ? " ".repeat(this.tabSize) : ""; const ins = "\n" + indent + extra; this._replaceRange(s, this.input.selectionEnd, ins, s + ins.length); this._paint(); this._emit(); }
  _replaceRange(start, end, text, caret) { const v = this.input.value; this.input.value = v.slice(0, start) + text + v.slice(end); const c = caret ?? start + text.length; this.input.selectionStart = this.input.selectionEnd = c; }
  _paint() {
    const value = this.input.value; const lines = value.split("\n");
    let g = ""; for (let i = 1; i <= lines.length; i++) { const err = this.errors.find((e) => e.line === i); g += `<div class="ce-lnum${err ? " ce-lnum-err" : ""}" data-l="${i}">${i}</div>`; } this.gutter.innerHTML = g;
    let state = {}, html = "";
    for (let i = 0; i < lines.length; i++) { const res = tokenizeLine(lines[i], this.language, state); state = res.state; const err = this.errors.find((e) => e.line === i + 1); const cls = err ? ' class="ce-line ce-line-err"' : ' class="ce-line"'; let lh = ""; for (const t of res.tokens) lh += `<span class="tok-${t.type}">${escapeHtml(t.text)}</span>`; html += `<span${cls}>${lh || "&nbsp;"}</span>\n`; }
    this.highlight.innerHTML = html; this._paintActiveLine();
  }
  _paintActiveLine() { const before = this.input.value.slice(0, this.input.selectionStart); const line = before.split("\n").length; this.gutter.querySelectorAll(".ce-lnum").forEach((el) => el.classList.toggle("ce-lnum-active", +el.dataset.l === line)); this._fire("cursor", { line, column: before.length - before.lastIndexOf("\n") }); }
  _emit() { if (this.onChangeCb) this.onChangeCb(this.getValue(), this.isDirty()); }
  getValue() { return this.input.value; }
  setValue(v) { this.input.value = v; this._pristine = v; this.errors = []; this._paint(); }
  setLanguage(l) { this.language = l; this._paint(); }
  isDirty() { return this.input.value !== this._pristine; }
  markClean() { this._pristine = this.input.value; this._paint(); }
  markErrors(e) { this.errors = e || []; this._paint(); }
  clearErrors() { this.errors = []; this._paint(); }
  focus() { this.input.focus(); }
  gotoLine(n) { const lines = this.input.value.split("\n"); let pos = 0; for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1; this.input.focus(); this.input.selectionStart = this.input.selectionEnd = pos; this._paintActiveLine(); const y = (n - 1) * this._lineHeight(); this.input.scrollTop = Math.max(0, y - this.input.clientHeight / 2); }
  _lineHeight() { return this._lh || (parseFloat(getComputedStyle(this.input).lineHeight) || parseFloat(getComputedStyle(this.input).fontSize) * 1.6); }
  find(term, { from = 0, caseSensitive = false } = {}) { if (!term) return -1; const hay = caseSensitive ? this.input.value : this.input.value.toLowerCase(); const idx = hay.indexOf(caseSensitive ? term : term.toLowerCase(), from); if (idx >= 0) { this.input.focus(); const line = this.input.value.slice(0, idx).split("\n").length; this.gotoLine(line); this.input.selectionStart = idx; this.input.selectionEnd = idx + term.length; } return idx; }
  replaceCurrent(term, repl) { if (this.input.selectionStart !== this.input.selectionEnd) { const sel = this.input.value.slice(this.input.selectionStart, this.input.selectionEnd); if (sel.toLowerCase() === term.toLowerCase()) { this._replaceRange(this.input.selectionStart, this.input.selectionEnd, repl); this._paint(); this._emit(); } } }
  replaceAll(term, repl, { caseSensitive = false } = {}) { if (!term) return 0; const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi"); const count = (this.input.value.match(re) || []).length; this.input.value = this.input.value.replace(re, repl); this._paint(); this._emit(); return count; }
  _handlers = {};
  on(evt, fn) { (this._handlers[evt] = this._handlers[evt] || []).push(fn); return this; }
  _fire(evt, data) { (this._handlers[evt] || []).forEach((f) => f(data)); }
  destroy() { if (this._ro) this._ro.disconnect(); this.root.remove(); }
}

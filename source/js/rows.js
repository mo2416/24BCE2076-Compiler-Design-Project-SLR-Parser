/*
 * rows.js — production-by-production grammar input, shared by the templates.
 *
 * The student sets the number of productions and fills one row per production
 * (left side → right side), the way lab programs ask for a grammar. A text mode
 * stays available for pasting, and both views are kept in sync.
 *
 * Markup uses neutral class names (pe-*); each template styles them its own way.
 *
 *   var ed = new ProductionEditor(hostEl, { onBuild: function (cfg) {...}, initial: cfg });
 *   ed.getCfg()   -> { grammar, input, spaceOnly }
 *   ed.setCfg(cfg)
 *   ed.showError(msg)
 */
(function (root) {
  'use strict';

  var esc = function (x) { return root.Core.esc(x); };
  var ARROW = /\s*(?:-->|->|→|::=)\s*/;
  var MAX_ROWS = 40;

  /* ---------- text <-> rows ---------- */

  function rowsFromText(text) {
    var rows = [], last = null;
    root.Grammar.normalize(text).split(/\r?\n/).forEach(function (line) {
      var clean = line.replace(/\/\/.*$/, '').trim();
      if (!clean) return;
      var alts;
      if (ARROW.test(clean)) {
        var parts = clean.split(ARROW);
        last = parts[0].trim();
        alts = parts.slice(1).join('->').split('|');
      } else if (clean[0] === '|' && last) {
        alts = clean.slice(1).split('|');
      } else {
        rows.push({ lhs: '', rhs: clean });
        return;
      }
      alts.forEach(function (a) { rows.push({ lhs: last, rhs: a.trim() || 'ε' }); });
    });
    return rows.length ? rows : [{ lhs: '', rhs: '' }];
  }

  /* One line per row; the start symbol's rows go first because the first rule names the start. */
  function textFromRows(rows, start) {
    var filled = rows.filter(function (r) { return r.lhs.trim() || r.rhs.trim(); });
    var first = filled.filter(function (r) { return r.lhs.trim() === start; });
    var rest = filled.filter(function (r) { return r.lhs.trim() !== start; });
    return first.concat(rest).map(function (r) { return r.lhs.trim() + ' -> ' + (r.rhs.trim() || 'ε'); }).join('\n');
  }

  /* Per-row problems, the symbols found, and how each right side was read. */
  function check(rows, spaceOnly) {
    var errs = rows.map(function () { return null; });
    var lhsSet = [];
    rows.forEach(function (r, i) {
      var L = r.lhs.trim(), R = r.rhs.trim();
      if (!L && !R) return;
      if (!L) errs[i] = 'The left side is empty.';
      else if (/\s/.test(L)) errs[i] = 'The left side must be one non-terminal, without spaces.';
      else if (L === '$' || /(^|\s)\$(\s|$)/.test(R) || R.indexOf('$') >= 0) errs[i] = '$ is reserved for the end of input.';
      else if (lhsSet.indexOf(L) < 0) lhsSet.push(L);
    });
    var parsed = null, error = null;
    var anyFilled = rows.some(function (r) { return r.lhs.trim(); });
    if (anyFilled && !errs.some(Boolean)) {
      try { parsed = root.Grammar.parseGrammar(textFromRows(rows, (rows.find(function (r) { return r.lhs.trim(); }) || {}).lhs.trim()), { spaceOnly: spaceOnly }); }
      catch (e) { error = e.message; }
    }
    var readAs = rows.map(function (r) {
      if (!parsed || !r.lhs.trim()) return null;
      var syms = [];
      try {
        var one = root.Grammar.parseGrammar(r.lhs.trim() + ' -> ' + (r.rhs.trim() || 'ε') + '\n' + lhsSet.filter(function (x) { return x !== r.lhs.trim(); }).map(function (x) { return x + ' -> ' + x; }).join('\n'), { spaceOnly: spaceOnly });
        syms = one.productions[1].rhs;
      } catch (e) { return null; }
      var typed = r.rhs.trim().split(/\s+/).filter(Boolean);
      return syms.join(' ') !== typed.join(' ') ? (syms.length ? syms.join(' ') : 'ε') : null;
    });
    var undefinedNT = [];
    if (parsed) {
      parsed.terminals.forEach(function (t) { if (/^[A-Z][A-Za-z0-9']*$/.test(t) && undefinedNT.indexOf(t) < 0) undefinedNT.push(t); });
    }
    return { errs: errs, parsed: parsed, error: error, nts: lhsSet, readAs: readAs, undefinedNT: undefinedNT };
  }

  /* ---------- component ---------- */

  function ProductionEditor(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.rows = [{ lhs: '', rhs: '' }];
    this.start = '';
    this.textMode = false;
    this.render();
    this.bind();
    if (this.opts.initial) this.setCfg(this.opts.initial);
  }

  ProductionEditor.prototype.render = function () {
    var ex = root.Core.examples();
    this.host.innerHTML =
      '<div class="pe">' +
        '<div class="pe-top">' +
          (this.opts.dynamic ? '<div class="pe-count pe-dyn"><span class="pe-label">Productions</span><span class="pe-hint" style="margin:0">Type in the last row and a new one appears.</span></div>' : '<div class="pe-count"><label class="pe-label" for="' + this.id('count') + '">Number of productions</label>' +
            '<div class="pe-stepper"><button type="button" data-pe="dec" aria-label="One production fewer">−</button>' +
            '<input type="number" inputmode="numeric" min="1" max="' + MAX_ROWS + '" id="' + this.id('count') + '">' +
            '<button type="button" data-pe="inc" aria-label="One production more">+</button></div></div>') +
          '<div class="pe-tools">' +
            '<select class="pe-examples" aria-label="Load an example grammar"><option value="">Load a grammar…</option>' +
              ex.map(function (e) { return '<option value="' + e.id + '">' + esc(e.title) + '</option>'; }).join('') + '</select>' +
            '<button type="button" class="pe-mode" aria-pressed="false">Text mode</button>' +
          '</div>' +
        '</div>' +
        '<ol class="pe-rows"></ol>' +
        '<textarea class="pe-text" rows="7" spellcheck="false" aria-label="Grammar as text" hidden></textarea>' +
        '<p class="pe-hint pe-text-hint" hidden>One rule per line, <code>|</code> for alternatives. Switching back splits every alternative into its own row.</p>' +
        '<div class="pe-meta">' +
          '<label class="pe-label">Start symbol <select class="pe-start"></select></label>' +
          '<div class="pe-syms"></div>' +
        '</div>' +
        '<div class="pe-input">' +
          '<label class="pe-label" for="' + this.id('w') + '">Input string</label>' +
          '<input type="text" class="pe-w" id="' + this.id('w') + '" spellcheck="false" autocomplete="off" placeholder="e.g. id + id * id">' +
          '<div class="pe-keys" aria-label="Tap a terminal to add it to the input"></div>' +
        '</div>' +
        '<label class="pe-space"><input type="checkbox" class="pe-sp"> Every space-separated word is one symbol</label>' +
        '<p class="pe-error" role="alert" hidden></p>' +
        '<button type="button" class="pe-build">Build parser</button>' +
      '</div>';
    this.$ = function (sel) { return this.host.querySelector(sel); };
  };

  ProductionEditor.prototype.id = function (k) {
    if (!this._uid) this._uid = 'pe' + Math.random().toString(36).slice(2, 8);
    return this._uid + '-' + k;
  };

  ProductionEditor.prototype.paintRows = function () {
    var self = this;
    var ol = this.$('.pe-rows');
    var focusKey = document.activeElement && document.activeElement.getAttribute('data-k');
    var caret = document.activeElement && document.activeElement.selectionStart;
    ol.innerHTML = this.rows.map(function (r, i) {
      return '<li class="pe-row" data-i="' + i + '">' +
        '<span class="pe-n">(' + (i + 1) + ')</span>' +
        '<input type="text" class="pe-lhs" data-k="l' + i + '" value="' + esc(r.lhs) + '" spellcheck="false" autocomplete="off" aria-label="Left side of production ' + (i + 1) + '" placeholder="' + (self.opts.dynamic && i === self.rows.length - 1 ? 'new' : 'A') + '">' +
        '<span class="pe-arrow" aria-hidden="true">→</span>' +
        '<input type="text" class="pe-rhs" data-k="r' + i + '" value="' + esc(r.rhs) + '" spellcheck="false" autocomplete="off" aria-label="Right side of production ' + (i + 1) + '" placeholder="' + (self.opts.dynamic && i === self.rows.length - 1 ? 'type a production here, e.g.  a A' : 'α') + '">' +
        '<button type="button" class="pe-eps" data-i="' + i + '" title="Empty right side" aria-label="Set production ' + (i + 1) + ' to epsilon">ε</button>' +
        '<button type="button" class="pe-del" data-i="' + i + '" aria-label="Remove production ' + (i + 1) + '"' + (self.rows.length < 2 ? ' disabled' : '') + '>×</button>' +
        '<p class="pe-note" hidden></p>' +
      '</li>';
    }).join('');
    var num = this.$('input[type=number]'); if (num) num.value = this.rows.length;
    if (focusKey) {
      var el = ol.querySelector('[data-k="' + focusKey + '"]');
      if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* number inputs */ } }
    }
    this.validate();
  };

  /* Dynamic mode keeps exactly one empty row at the end. */
  ProductionEditor.prototype.tidy = function () {
    if (!this.opts.dynamic) return false;
    var r = this.rows, changed = false;
    while (r.length > 1 && !r[r.length - 1].lhs.trim() && !r[r.length - 1].rhs.trim() && !r[r.length - 2].lhs.trim() && !r[r.length - 2].rhs.trim()) { r.pop(); changed = true; }
    var last = r[r.length - 1];
    if (last.lhs.trim() || last.rhs.trim()) { r.push({ lhs: '', rhs: '' }); changed = true; }
    return changed;
  };

  ProductionEditor.prototype.validate = function () {
    var res = check(this.rows, this.$('.pe-sp').checked);
    var self = this;
    this.lastCheck = res;
    this.host.querySelectorAll('.pe-row').forEach(function (li, i) {
      var note = li.querySelector('.pe-note');
      var err = res.errs[i];
      li.classList.toggle('pe-bad', !!err);
      if (err) { note.hidden = false; note.className = 'pe-note pe-note-err'; note.textContent = err; }
      else if (res.readAs[i]) { note.hidden = false; note.className = 'pe-note'; note.textContent = 'read as: ' + self.rows[i].lhs.trim() + ' → ' + res.readAs[i]; }
      else note.hidden = true;
    });
    /* start symbol choices */
    var sel = this.$('.pe-start');
    if (!res.nts.length) this.start = '';
    else if (res.nts.indexOf(this.start) < 0) this.start = res.nts[0];
    sel.innerHTML = res.nts.map(function (n) { return '<option' + (n === self.start ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') || '<option value="">—</option>';
    /* symbols and warnings */
    var syms = '';
    if (res.parsed) {
      syms += '<div><span class="pe-label">Non-terminals</span>' + res.parsed.nonTerminals.slice(1).map(function (x) { return '<span class="pe-chip pe-nt">' + esc(x) + '</span>'; }).join('') + '</div>';
      syms += '<div><span class="pe-label">Terminals</span>' + res.parsed.terminals.map(function (x) { return '<span class="pe-chip pe-t">' + esc(x) + '</span>'; }).join('') + '</div>';
      if (res.undefinedNT.length) syms += '<p class="pe-warn">' + res.undefinedNT.map(esc).join(', ') + (res.undefinedNT.length > 1 ? ' look like non-terminals but have' : ' looks like a non-terminal but has') + ' no production, so ' + (res.undefinedNT.length > 1 ? 'they are' : 'it is') + ' treated as terminal' + (res.undefinedNT.length > 1 ? 's' : '') + '.</p>';
    } else if (res.error) syms = '<p class="pe-warn">' + esc(res.error) + '</p>';
    this.$('.pe-syms').innerHTML = syms;
    /* terminal keys for the input string */
    var keys = res.parsed ? res.parsed.terminals : [];
    this.$('.pe-keys').innerHTML = keys.map(function (t) { return '<button type="button" class="pe-key" data-t="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
      (keys.length ? '<button type="button" class="pe-key pe-key-fn" data-fn="back" aria-label="Remove the last token">⌫</button><button type="button" class="pe-key pe-key-fn" data-fn="clear">Clear</button>' : '');
    return res;
  };

  ProductionEditor.prototype.setCount = function (n) {
    n = Math.max(1, Math.min(MAX_ROWS, n | 0));
    while (this.rows.length < n) this.rows.push({ lhs: '', rhs: '' });
    if (this.rows.length > n) this.rows.length = n;
    this.paintRows();
  };

  ProductionEditor.prototype.setTextMode = function (on) {
    if (on === this.textMode) return;
    if (on) this.$('.pe-text').value = textFromRows(this.rows, this.start);
    else { this.rows = rowsFromText(this.$('.pe-text').value); this.paintRows(); }
    this.textMode = on;
    this.$('.pe-mode').setAttribute('aria-pressed', on);
    this.$('.pe-mode').textContent = on ? 'Row mode' : 'Text mode';
    this.$('.pe-rows').hidden = on;
    this.$('.pe-text').hidden = !on;
    this.$('.pe-text-hint').hidden = !on;
    this.$('.pe-count').classList.toggle('pe-off', on);
  };

  ProductionEditor.prototype.getCfg = function () {
    if (this.textMode) { this.rows = rowsFromText(this.$('.pe-text').value); this.validate(); }
    return { grammar: textFromRows(this.rows, this.start), input: this.$('.pe-w').value, spaceOnly: this.$('.pe-sp').checked };
  };

  ProductionEditor.prototype.setCfg = function (cfg) {
    this.rows = rowsFromText(cfg.grammar || '');
    this.start = (this.rows[0] || {}).lhs || '';
    this.tidy();
    this.$('.pe-w').value = cfg.input || '';
    this.$('.pe-sp').checked = !!cfg.spaceOnly;
    if (this.textMode) this.$('.pe-text').value = textFromRows(this.rows, this.start);
    this.paintRows();
  };

  ProductionEditor.prototype.showError = function (msg) {
    var p = this.$('.pe-error');
    p.hidden = !msg;
    p.textContent = msg || '';
  };

  ProductionEditor.prototype.bind = function () {
    var self = this, h = this.host;
    h.addEventListener('input', function (e) {
      var li = e.target.closest('.pe-row');
      if (li) {
        var i = +li.getAttribute('data-i');
        if (e.target.classList.contains('pe-lhs')) self.rows[i].lhs = e.target.value;
        if (e.target.classList.contains('pe-rhs')) self.rows[i].rhs = e.target.value;
        if (self.tidy()) self.paintRows(); else self.validate();
      }
      if (e.target.type === 'number' && e.target.value !== '') self.setCount(+e.target.value);
    });
    h.addEventListener('change', function (e) {
      if (e.target.classList.contains('pe-start')) self.start = e.target.value;
      if (e.target.classList.contains('pe-sp')) self.validate();
      if (e.target.classList.contains('pe-examples') && e.target.value) {
        var ex = root.Core.example(e.target.value);
        e.target.value = '';
        self.setCfg({ grammar: ex.grammar, input: ex.input, spaceOnly: false });
        if (self.opts.onExample) self.opts.onExample(ex);
        self.build();
      }
    });
    h.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var pe = b.getAttribute('data-pe');
      if (pe === 'inc') self.setCount(self.rows.length + 1);
      if (pe === 'dec') self.setCount(self.rows.length - 1);
      if (b.classList.contains('pe-eps')) { self.rows[+b.getAttribute('data-i')].rhs = 'ε'; self.tidy(); self.paintRows(); }
      if (b.classList.contains('pe-del')) { self.rows.splice(+b.getAttribute('data-i'), 1); if (!self.rows.length) self.rows.push({ lhs: '', rhs: '' }); self.tidy(); self.paintRows(); }
      if (b.classList.contains('pe-mode')) self.setTextMode(!self.textMode);
      if (b.classList.contains('pe-key')) {
        var w = self.$('.pe-w'), toks = w.value.trim() ? w.value.trim().split(/\s+/) : [];
        if (b.getAttribute('data-fn') === 'back') toks.pop();
        else if (b.getAttribute('data-fn') === 'clear') toks = [];
        else toks.push(b.getAttribute('data-t'));
        w.value = toks.join(' ');
      }
      if (b.classList.contains('pe-build')) self.build();
    });
    h.addEventListener('keydown', function (e) {
      /* Enter in a row moves to the next field, adding a row at the end; Ctrl+Enter builds. */
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); self.build(); return; }
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      if (e.target.classList.contains('pe-w')) { e.preventDefault(); self.build(); return; }
      var li = e.target.closest('.pe-row');
      if (!li) return;
      e.preventDefault();
      var i = +li.getAttribute('data-i');
      if (e.target.classList.contains('pe-lhs')) { li.querySelector('.pe-rhs').focus(); return; }
      if (i === self.rows.length - 1) { self.rows.push({ lhs: self.rows[i].lhs, rhs: '' }); self.paintRows(); }
      var next = h.querySelector('.pe-row[data-i="' + (i + 1) + '"] .pe-rhs');
      if (next) next.focus();
    });
  };

  ProductionEditor.prototype.build = function () {
    var res = this.textMode ? null : this.validate();
    if (res && res.errs.some(Boolean)) { this.showError('Fix the highlighted production first.'); return; }
    var cfg = this.getCfg();
    if (!cfg.grammar.trim()) { this.showError('Enter at least one production.'); return; }
    this.showError('');
    if (this.opts.onBuild) this.opts.onBuild(cfg);
  };

  root.ProductionEditor = ProductionEditor;
  root.ProductionRows = { rowsFromText: rowsFromText, textFromRows: textFromRows, check: check };
})(this);

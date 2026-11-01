/**
 * 2D Virtual Dev Office - Integrations (MCP & Skills settings)
 * Global + per-character MCP servers and Skills configuration.
 *
 * Storage schema (localStorage):
 *   voffice_mcp_settings    = { global: [serverName,...], perAgent: { agentId: [serverName,...] } }
 *   voffice_skills_settings = { global: [skillName,...],  perAgent: { agentId: [skillName,...] } }
 *
 * Global accessors exposed for other modules:
 *   window.getMcpSettings()            -> normalized settings object
 *   window.getSkillsSettings()         -> normalized settings object
 *   window.getMcpForAgent(agentId)     -> deduped perAgent[agentId] + global
 *   window.getSkillsForAgent(agentId)  -> deduped perAgent[agentId] + global
 *   window.saveIntegrationsSettings()  -> persist whatever is currently in storage
 */

const INTEGRATIONS_MCP_KEY = 'voffice_mcp_settings';
const INTEGRATIONS_SKILLS_KEY = 'voffice_skills_settings';

// Used when the /api/skills/list endpoint is unavailable (e.g. python http.server).
const INTEGRATIONS_FALLBACK_SKILLS = [
  'caveman',
  'caveman-commit',
  'caveman-review',
  'caveman-explore',
  'cavecrew',
  'caveman-help'
];

// A few well-known MCP servers offered as quick-add suggestions.
const INTEGRATIONS_MCP_SUGGESTIONS = [
  'filesystem',
  'github',
  'fetch',
  'memory',
  'sqlite',
  'puppeteer',
  'sequential-thinking'
];

const SAVE_TOAST_MSG = 'Pengaturan MCP/Skills disimpan';

// Runtime-only state (discovered skills for the active project).
const _integrationsState = {
  skills: [],
  skillsFallback: false,
  skillsNote: ''
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

// Local escape helper so this module never breaks if app.js loads late.
function _esc(value) {
  const str = (value === null || value === undefined) ? '' : String(value);
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  return str.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function _toast(type, message) {
  try {
    if (typeof showToast === 'function') showToast(type, message);
  } catch (e) { /* never throw out of a handler */ }
}

function _click() {
  try {
    if (typeof soundFx !== 'undefined' && soundFx && soundFx.playClick) soundFx.playClick();
  } catch (e) { /* ignore */ }
}

function _dedupe(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(function (item) {
    const name = (item === null || item === undefined) ? '' : String(item).trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });
  return out;
}

function _agents() {
  try {
    if (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents) {
      return Object.keys(OFFICE_CONFIG.agents).map(function (id) {
        return OFFICE_CONFIG.agents[id];
      });
    }
  } catch (e) { /* ignore */ }
  return [];
}

/* ------------------------------------------------------------------ *
 * Storage read / write
 * ------------------------------------------------------------------ */

function _readSettings(key) {
  const empty = { global: [], perAgent: {} };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;

    const global = Array.isArray(parsed.global) ? _dedupe(parsed.global) : [];
    const perAgent = {};
    if (parsed.perAgent && typeof parsed.perAgent === 'object') {
      Object.keys(parsed.perAgent).forEach(function (agentId) {
        if (Array.isArray(parsed.perAgent[agentId])) {
          const list = _dedupe(parsed.perAgent[agentId]);
          if (list.length) perAgent[agentId] = list;
        }
      });
    }
    return { global: global, perAgent: perAgent };
  } catch (e) {
    return empty;
  }
}

function _writeSettings(key, settings, options) {
  const opts = options || {};
  try {
    const payload = {
      global: _dedupe(settings.global),
      perAgent: {}
    };
    Object.keys(settings.perAgent || {}).forEach(function (agentId) {
      const list = _dedupe(settings.perAgent[agentId]);
      if (list.length) payload.perAgent[agentId] = list;
    });
    localStorage.setItem(key, JSON.stringify(payload));
    if (opts.toast !== false) _toast('success', SAVE_TOAST_MSG);
    return payload;
  } catch (e) {
    if (opts.toast !== false) _toast('error', 'Gagal menyimpan pengaturan: ' + (e && e.message ? e.message : e));
    return { global: [], perAgent: {} };
  }
}

// Effective list for one agent = perAgent[agentId] concat global, deduped. Global first.
function _effectiveFor(key, agentId) {
  const settings = _readSettings(key);
  const per = (agentId && settings.perAgent[agentId]) ? settings.perAgent[agentId] : [];
  return _dedupe(settings.global.concat(per));
}

/* ------------------------------------------------------------------ *
 * Global accessors (used by other modules)
 * ------------------------------------------------------------------ */

window.getMcpSettings = function () {
  return _readSettings(INTEGRATIONS_MCP_KEY);
};

window.getSkillsSettings = function () {
  return _readSettings(INTEGRATIONS_SKILLS_KEY);
};

window.getMcpForAgent = function (agentId) {
  return _effectiveFor(INTEGRATIONS_MCP_KEY, agentId);
};

window.getSkillsForAgent = function (agentId) {
  return _effectiveFor(INTEGRATIONS_SKILLS_KEY, agentId);
};

window.saveIntegrationsSettings = function () {
  try {
    _writeSettings(INTEGRATIONS_MCP_KEY, _readSettings(INTEGRATIONS_MCP_KEY));
    _writeSettings(INTEGRATIONS_SKILLS_KEY, _readSettings(INTEGRATIONS_SKILLS_KEY), { toast: false });
    return true;
  } catch (e) {
    return false;
  }
};

/* ------------------------------------------------------------------ *
 * Styles (scoped, injected once)
 * ------------------------------------------------------------------ */

function _injectIntegrationsStyles() {
  try {
    if (document.getElementById('integrationsStyles')) return;
    const style = document.createElement('style');
    style.id = 'integrationsStyles';
    style.textContent = [
      '.integrations-help{font-size:11px;color:var(--text-muted,#94a3b8);margin:-4px 0 10px;line-height:1.5;}',
      '.integrations-chip{cursor:pointer;display:inline-flex;align-items:center;gap:6px;}',
      '.integrations-chip b{font-size:12px;line-height:1;}',
      '.integrations-chip:hover{background:rgba(244,63,94,.15);color:#fb7185;border-color:rgba(244,63,94,.5);box-shadow:none;}',
      '.integrations-note{font-size:10.5px;color:var(--text-muted,#94a3b8);margin-top:8px;font-style:italic;}',
      '.integrations-matrix-wrap{overflow-x:auto;margin-top:12px;border:1px solid var(--border-color,rgba(255,255,255,.1));border-radius:8px;}',
      '.integrations-matrix{border-collapse:collapse;width:100%;font-size:11px;}',
      '.integrations-matrix th,.integrations-matrix td{border-bottom:1px solid var(--border-color,rgba(255,255,255,.08));padding:6px 10px;text-align:center;white-space:nowrap;}',
      '.integrations-matrix thead th{color:var(--text-secondary,#cbd5e1);font-weight:600;font-size:10px;background:rgba(255,255,255,.03);}',
      '.integrations-col-label{display:inline-block;max-width:130px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;}',
      '.integrations-agent-cell{text-align:left;color:var(--text-primary,#e2e8f0);}',
      '.integrations-matrix tbody tr:last-child td{border-bottom:none;}',
      '.integrations-matrix tbody tr:hover{background:rgba(255,255,255,.03);}',
      '.integrations-check{width:15px;height:15px;accent-color:#38bdf8;cursor:pointer;}',
      '.integrations-empty{font-size:11px;color:var(--text-muted,#94a3b8);padding:8px 0;font-style:italic;}',
      '.integrations-skill-list{display:flex;flex-direction:column;gap:6px;margin-top:10px;}',
      '.integrations-skill-item{background:rgba(255,255,255,.025);border:1px solid var(--border-color,rgba(255,255,255,.08));border-radius:6px;padding:7px 10px;font-size:11px;}',
      '.integrations-skill-item strong{color:#7dd3fc;display:block;margin-bottom:2px;}',
      '.integrations-skill-item span{color:var(--text-muted,#94a3b8);line-height:1.4;}'
    ].join('');
    document.head.appendChild(style);
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ *
 * Markup skeleton
 * ------------------------------------------------------------------ */

function _integrationsCardHtml() {
  return '' +
    '<div class="settings-section" id="integrationsCard">' +

    // ---- MCP card ----
    '  <div class="card-section" id="mcpSection">' +
    '    <div class="card-title"><span class="card-title-text">🔌 MCP Servers</span></div>' +
    '    <p class="integrations-help">Server MCP global berlaku untuk semua karakter. Centang kotak pada matriks untuk memberi akses khusus per karakter.</p>' +
    '    <div class="form-row" style="margin-bottom:10px;">' +
    '      <input type="text" id="mcpGlobalInput" class="form-input" placeholder="Nama server MCP (mis. filesystem)" autocomplete="off">' +
    '      <button type="button" class="btn-secondary" id="mcpAddBtn" style="flex:0 0 auto;">➕ Tambah</button>' +
    '    </div>' +
    '    <div class="presets-container" id="mcpGlobalChips"></div>' +
    '    <div class="presets-container" id="mcpSuggestions" style="margin-top:6px;"></div>' +
    '    <div class="info-alert" style="margin-top:10px;">ℹ️ Entri MCP berikut otomatis <strong>disuntikkan sebagai konteks</strong> ke dalam system prompt tiap karakter, sehingga agen tahu tool/server MCP apa saja yang tersedia untuknya.</div>' +
    '    <div class="integrations-matrix-wrap" id="mcpMatrixWrap"></div>' +
    '  </div>' +

    // ---- Skills card ----
    '  <div class="card-section" id="skillsSection">' +
    '    <div class="card-title"><span class="card-title-text">🧩 Skills</span></div>' +
    '    <p class="integrations-help">Skill global aktif untuk semua karakter. Centang kotak pada matriks untuk mengaktifkan skill khusus per karakter.</p>' +
    '    <div class="form-row" style="margin-bottom:10px;">' +
    '      <input type="text" id="skillsGlobalInput" class="form-input" placeholder="Nama skill (mis. caveman-review)" autocomplete="off">' +
    '      <button type="button" class="btn-secondary" id="skillsAddBtn" style="flex:0 0 auto;">➕ Tambah</button>' +
    '    </div>' +
    '    <div class="presets-container" id="skillsGlobalChips"></div>' +
    '    <div class="integrations-skill-list" id="skillsDiscoveredList"></div>' +
    '    <div class="integrations-note" id="skillsSourceNote"></div>' +
    '    <div class="integrations-matrix-wrap" id="skillsMatrixWrap"></div>' +
    '  </div>' +

    // ---- Save (belt & braces) ----
    '  <button type="button" class="btn-primary" id="integrationsSaveBtn" style="width:100%;">💾 Simpan Pengaturan MCP &amp; Skills</button>' +
    '</div>';
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function _renderChips(kind) {
  const isSkills = kind === 'skills';
  const key = isSkills ? INTEGRATIONS_SKILLS_KEY : INTEGRATIONS_MCP_KEY;
  const el = document.getElementById(isSkills ? 'skillsGlobalChips' : 'mcpGlobalChips');
  if (!el) return;
  const settings = _readSettings(key);

  if (!settings.global.length) {
    el.innerHTML = '<span class="integrations-note" style="margin:0;">Belum ada ' +
      (isSkills ? 'skill' : 'MCP server') + ' global.</span>';
    return;
  }

  el.innerHTML = settings.global.map(function (name) {
    return '<span class="preset-chip integrations-chip" data-kind="' + kind + '" data-name="' +
      _esc(name) + '" title="Klik untuk menghapus">' + _esc(name) + ' <b>×</b></span>';
  }).join('');
}

function _renderSuggestions() {
  const el = document.getElementById('mcpSuggestions');
  if (!el) return;
  const settings = _readSettings(INTEGRATIONS_MCP_KEY);
  const remaining = INTEGRATIONS_MCP_SUGGESTIONS.filter(function (name) {
    return settings.global.indexOf(name) === -1;
  });

  if (!remaining.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = '<span class="integrations-note" style="margin:0;font-style:normal;">Saran:</span> ' +
    remaining.map(function (name) {
      return '<span class="preset-chip integrations-chip" data-kind="mcp-suggest" data-name="' +
        _esc(name) + '" title="Tambahkan ke global">+ ' + _esc(name) + '</span>';
    }).join('');
}

// Columns for the matrix = discovered/known names + global + every perAgent entry.
function _availableNames(key, extraNames) {
  const settings = _readSettings(key);
  const names = _dedupe((extraNames || []).concat(settings.global));
  Object.keys(settings.perAgent).forEach(function (agentId) {
    names.push.apply(names, settings.perAgent[agentId]);
  });
  return _dedupe(names);
}

function _renderMatrix(kind) {
  const isSkills = kind === 'skills';
  const key = isSkills ? INTEGRATIONS_SKILLS_KEY : INTEGRATIONS_MCP_KEY;
  const wrap = document.getElementById(isSkills ? 'skillsMatrixWrap' : 'mcpMatrixWrap');
  if (!wrap) return;

  const extra = isSkills
    ? _integrationsState.skills.map(function (s) { return s.name; })
    : [];
  const names = _availableNames(key, extra);
  const agents = _agents();

  if (!names.length) {
    wrap.innerHTML = '<div class="integrations-empty" style="padding:10px;">' +
      (isSkills
        ? 'Belum ada skill. Skill proyek dari <code>.agents/skills</code> akan muncul otomatis, atau tambahkan manual di atas.'
        : 'Belum ada MCP server. Tambahkan nama server di atas untuk membuka matriks per karakter.') +
      '</div>';
    return;
  }

  let html = '<table class="integrations-matrix"><thead><tr><th style="text-align:left;">Karakter</th>';
  names.forEach(function (name) {
    html += '<th title="' + _esc(name) + '"><span class="integrations-col-label">' + _esc(name) + '</span></th>';
  });
  html += '</tr></thead><tbody>';

  if (!agents.length) {
    html += '<tr><td colspan="' + (names.length + 1) + '" class="integrations-empty" style="padding:10px;">Daftar karakter tidak tersedia (OFFICE_CONFIG belum dimuat).</td></tr>';
  }

  agents.forEach(function (agent) {
    const selected = new Set(_effectiveFor(key, agent.id));
    const label = (agent.emoji ? agent.emoji + ' ' : '') + (agent.name || agent.id);
    html += '<tr><td class="integrations-agent-cell" title="' + _esc(agent.fullName || agent.role || agent.id) + '">' + _esc(label) + '</td>';
    names.forEach(function (name) {
      html += '<td><input type="checkbox" class="integrations-check" data-kind="' + kind +
        '" data-agent="' + _esc(agent.id) + '" data-name="' + _esc(name) + '"' +
        (selected.has(name) ? ' checked' : '') + '></td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function _renderSkillsDiscovered() {
  const el = document.getElementById('skillsDiscoveredList');
  const noteEl = document.getElementById('skillsSourceNote');
  if (!el) return;

  const skills = _integrationsState.skills;
  if (skills.length) {
    el.innerHTML = skills.map(function (s) {
      return '<div class="integrations-skill-item"><strong>' + _esc(s.name) + '</strong>' +
        '<span>' + _esc(s.description || 'Tanpa deskripsi.') + '</span></div>';
    }).join('');
  } else {
    el.innerHTML = '';
  }

  if (noteEl) {
    noteEl.textContent = _integrationsState.skillsNote || '';
  }
}

function _renderAll() {
  _renderChips('mcp');
  _renderSuggestions();
  _renderMatrix('mcp');
  _renderChips('skills');
  _renderSkillsDiscovered();
  _renderMatrix('skills');
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

function _addGlobal(kind, rawName) {
  const isSkills = kind === 'skills';
  const key = isSkills ? INTEGRATIONS_SKILLS_KEY : INTEGRATIONS_MCP_KEY;
  const label = isSkills ? 'skill' : 'MCP server';
  const name = (rawName === null || rawName === undefined) ? '' : String(rawName).trim();

  if (!name) {
    _toast('error', 'Nama ' + label + ' tidak boleh kosong.');
    return;
  }

  try {
    const settings = _readSettings(key);
    if (settings.global.indexOf(name) !== -1) {
      _toast('info', '"' + name + '" sudah ada di daftar global.');
      return;
    }
    settings.global.push(name);
    _writeSettings(key, settings);
    _click();

    const input = document.getElementById(isSkills ? 'skillsGlobalInput' : 'mcpGlobalInput');
    if (input) input.value = '';

    _renderAll();
  } catch (e) {
    _toast('error', 'Gagal menambah ' + label + ': ' + (e && e.message ? e.message : e));
  }
}

function _removeGlobal(kind, name) {
  const isSkills = kind === 'skills';
  const key = isSkills ? INTEGRATIONS_SKILLS_KEY : INTEGRATIONS_MCP_KEY;
  try {
    const settings = _readSettings(key);
    settings.global = settings.global.filter(function (n) { return n !== name; });
    _writeSettings(key, settings);
    _click();
    _renderAll();
  } catch (e) {
    _toast('error', 'Gagal menghapus: ' + (e && e.message ? e.message : e));
  }
}

function _togglePerAgent(kind, agentId, name, checked) {
  if (!agentId || !name) return;
  const isSkills = kind === 'skills';
  const key = isSkills ? INTEGRATIONS_SKILLS_KEY : INTEGRATIONS_MCP_KEY;
  try {
    const settings = _readSettings(key);
    const list = settings.perAgent[agentId] || [];
    if (checked) {
      if (list.indexOf(name) === -1) list.push(name);
    } else {
      settings.perAgent[agentId] = list.filter(function (n) { return n !== name; });
      _writeSettings(key, settings);
      _renderMatrix(kind);
      return;
    }
    settings.perAgent[agentId] = list;
    _writeSettings(key, settings);
    _click();
    _renderMatrix(kind);
  } catch (e) {
    _toast('error', 'Gagal menyimpan pilihan: ' + (e && e.message ? e.message : e));
  }
}

/* ------------------------------------------------------------------ *
 * Skills discovery
 * ------------------------------------------------------------------ */

function _applyFallbackSkills(noteText) {
  _integrationsState.skillsFallback = true;
  _integrationsState.skills = INTEGRATIONS_FALLBACK_SKILLS.map(function (name) {
    return { name: name, description: '', dir: name };
  });
  _integrationsState.skillsNote = noteText || '⚠️ API /api/skills/list tidak tersedia — memakai daftar skill bawaan. Jalankan dengan node server.js agar skill proyek terdeteksi otomatis.';
  _renderSkillsDiscovered();
  _renderMatrix('skills');
}

async function _loadProjectSkills() {
  let projectPath = '';
  try {
    if (typeof sprintManager !== 'undefined' && sprintManager && typeof sprintManager.getActiveProject === 'function') {
      const project = sprintManager.getActiveProject();
      projectPath = (project && project.path) ? project.path : '';
    }
  } catch (e) { projectPath = ''; }

  if (!projectPath) {
    _applyFallbackSkills('⚠️ Tidak ada project aktif terdeteksi — memakai daftar skill bawaan.');
    return;
  }

  try {
    const res = await fetch('/api/skills/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: projectPath })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.error) ? data.error : 'respons tidak valid');
    }

    const skills = Array.isArray(data.skills) ? data.skills : [];
    _integrationsState.skillsFallback = false;
    _integrationsState.skills = skills.map(function (s) {
      return {
        name: (s && s.name) ? s.name : ((s && s.dir) ? s.dir : ''),
        description: (s && s.description) ? s.description : '',
        dir: (s && s.dir) ? s.dir : ''
      };
    }).filter(function (s) { return s.name; });

    _integrationsState.skillsNote = _integrationsState.skills.length
      ? '✅ ' + _integrationsState.skills.length + ' skill proyek ditemukan di ' + projectPath + '/.agents/skills.'
      : 'Tidak ada skill proyek di ' + projectPath + '/.agents/skills — tambahkan manual bila perlu.';

    _renderSkillsDiscovered();
    _renderMatrix('skills');
  } catch (err) {
    _applyFallbackSkills('⚠️ Gagal memuat skill proyek (' + (err && err.message ? err.message : err) + ') — memakai daftar bawaan.');
  }
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function _attachIntegrationsEvents(container) {
  // Add buttons
  const mcpAddBtn = document.getElementById('mcpAddBtn');
  if (mcpAddBtn) mcpAddBtn.addEventListener('click', function () {
    const input = document.getElementById('mcpGlobalInput');
    _addGlobal('mcp', input ? input.value : '');
  });

  const skillsAddBtn = document.getElementById('skillsAddBtn');
  if (skillsAddBtn) skillsAddBtn.addEventListener('click', function () {
    const input = document.getElementById('skillsGlobalInput');
    _addGlobal('skills', input ? input.value : '');
  });

  // Enter key on the text inputs
  const mcpInput = document.getElementById('mcpGlobalInput');
  if (mcpInput) mcpInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); _addGlobal('mcp', mcpInput.value); }
  });

  const skillsInput = document.getElementById('skillsGlobalInput');
  if (skillsInput) skillsInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); _addGlobal('skills', skillsInput.value); }
  });

  // Save button (belt & braces)
  const saveBtn = document.getElementById('integrationsSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    try {
      window.saveIntegrationsSettings();
      _toast('success', SAVE_TOAST_MSG);
      if (typeof soundFx !== 'undefined' && soundFx && soundFx.playComplete) soundFx.playComplete();
    } catch (e) { /* ignore */ }
  });

  // Chip clicks (global add/remove) + checkbox toggles via delegation
  container.addEventListener('click', function (e) {
    const chip = e.target && e.target.closest ? e.target.closest('.integrations-chip') : null;
    if (!chip) return;
    const kind = chip.getAttribute('data-kind');
    const name = chip.getAttribute('data-name');
    if (!name) return;
    if (kind === 'mcp-suggest') { _addGlobal('mcp', name); return; }
    _removeGlobal(kind, name);
  });

  container.addEventListener('change', function (e) {
    const target = e.target;
    if (!target || !target.classList || !target.classList.contains('integrations-check')) return;
    _togglePerAgent(
      target.getAttribute('data-kind'),
      target.getAttribute('data-agent'),
      target.getAttribute('data-name'),
      !!target.checked
    );
  });
}

/* ------------------------------------------------------------------ *
 * Entry point (called by app.js on DOMContentLoaded)
 * ------------------------------------------------------------------ */

function initIntegrations() {
  try {
    const container = document.getElementById('integrationsSettingsContainer');
    if (!container) return;

    _injectIntegrationsStyles();
    container.innerHTML = _integrationsCardHtml();

    _renderAll();
    _attachIntegrationsEvents(container);

    // Discover project skills asynchronously (never blocks / never throws).
    _loadProjectSkills();
  } catch (e) {
    try { console.warn('initIntegrations failed:', e); } catch (err) { /* ignore */ }
  }
}

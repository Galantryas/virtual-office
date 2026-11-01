/**
 * 2D Virtual Dev Office - Character Manager
 * Setup page to add/remove characters. Each character's job can be AI-generated.
 *
 * Storage schema
 * --------------
 * localStorage['voffice_characters']
 *   Array of agent configs (same shape as OFFICE_CONFIG.agents entries):
 *   { id, name, fullName, role, tag, color, accentBg, borderColor, badgeClass,
 *     emoji, hairColor, outfitColor, pantsColor, skinColor, accessory,
 *     description, defaultRoom, targetStation }
 *
 * localStorage['voffice_agent_settings']
 *   { [agentId]: { name, fullName, model, customSystemPrompt } }
 *   (customSystemPrompt holds the AI generated technical job spec)
 */

const CHARACTER_ROSTER_KEY = 'voffice_characters';
const CHARACTER_AGENT_SETTINGS_KEY = 'voffice_agent_settings';

// Fallback visual palette for brand new characters (round-robin).
const CHARACTER_PALETTE = [
  { color: '#6366f1', outfitColor: '#4f46e5', pantsColor: '#1e1b4b', hairColor: '#334155', skinColor: '#fde047' },
  { color: '#06b6d4', outfitColor: '#0891b2', pantsColor: '#334155', hairColor: '#831843', skinColor: '#fed7aa' },
  { color: '#10b981', outfitColor: '#059669', pantsColor: '#0f172a', hairColor: '#1e293b', skinColor: '#fde68a' },
  { color: '#f43f5e', outfitColor: '#e11d48', pantsColor: '#18181b', hairColor: '#18181b', skinColor: '#fef08a' },
  { color: '#f59e0b', outfitColor: '#d97706', pantsColor: '#1e293b', hairColor: '#4a2c11', skinColor: '#fcd34d' },
  { color: '#a855f7', outfitColor: '#9333ea', pantsColor: '#1e1b4b', hairColor: '#3b0764', skinColor: '#fde68a' }
];

// Module state
let characterRoster = null;
let characterEditingId = null;

/* ------------------------------------------------------------------ */
/* Defensive helpers                                                   */
/* ------------------------------------------------------------------ */

function cmEscape(str) {
  const value = (str === null || str === undefined) ? '' : String(str);
  try {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
  } catch (e) {}
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cmToast(type, message) {
  try {
    if (typeof showToast === 'function') {
      showToast(type, message);
      return;
    }
  } catch (e) {}
  try { console.log(`[character-manager:${type}] ${message}`); } catch (e) {}
}

function cmDeepCopy(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return null; }
}

function cmGetCharacters() {
  try {
    if (typeof characters !== 'undefined' && characters) return characters;
  } catch (e) {}
  return null;
}

function cmGetRenderer() {
  try {
    if (typeof renderer !== 'undefined' && renderer) return renderer;
  } catch (e) {}
  return null;
}

function cmIsHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function cmHexToRgba(hex, alpha) {
  if (!cmIsHexColor(hex)) return `rgba(148, 163, 184, ${alpha})`;
  const clean = hex.trim().slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function cmSlugifyId(name) {
  const slug = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return slug || 'agent';
}

function cmUniqueId(base) {
  const taken = new Set((characterRoster || []).map(c => c && c.id));
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}_${counter}`;
    counter++;
  }
  return id;
}

function cmTruncate(str, max) {
  const value = String(str || '');
  if (value.length <= max) return value;
  return value.slice(0, max).trim() + '...';
}

function cmShortRole(cfg) {
  if (!cfg) return '';
  if (cfg.tag === 'reception') return 'Front Desk';
  const tag = String(cfg.tag || '').trim();
  if (tag) return tag.charAt(0).toUpperCase() + tag.slice(1);
  return String(cfg.role || '').split(/[\s&(-]/)[0] || '';
}

function cmVal(id) {
  const el = document.getElementById(id);
  return el && typeof el.value === 'string' ? el.value.trim() : '';
}

function cmChecked(id) {
  const el = document.getElementById(id);
  return !!(el && el.checked);
}

function cmSetVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = (value === null || value === undefined) ? '' : String(value);
}

/* ------------------------------------------------------------------ */
/* Roster storage                                                      */
/* ------------------------------------------------------------------ */

function cmNormalizeConfig(cfg, index) {
  const src = (cfg && typeof cfg === 'object') ? cfg : {};
  const i = Number.isFinite(index) ? Math.abs(Math.floor(index)) : 0;
  const pal = CHARACTER_PALETTE[i % CHARACTER_PALETTE.length] || CHARACTER_PALETTE[0];

  const name = String(src.name || src.id || 'Karakter').trim() || 'Karakter';
  const role = String(src.role || 'Anggota Tim').trim() || 'Anggota Tim';
  const id = String(src.id || cmSlugifyId(name)).trim() || cmSlugifyId(name);
  const tag = String(src.tag || cmSlugifyId(role).split('_')[0] || 'team').trim() || 'team';
  const color = cmIsHexColor(src.color) ? src.color : pal.color;

  return {
    id: id,
    name: name,
    fullName: String(src.fullName || `${name} (${role})`),
    role: role,
    tag: tag,
    color: color,
    accentBg: src.accentBg || cmHexToRgba(color, 0.2),
    borderColor: src.borderColor || color,
    badgeClass: src.badgeClass || tag,
    emoji: String(src.emoji || '🧑‍💻'),
    hairColor: src.hairColor || pal.hairColor,
    outfitColor: src.outfitColor || pal.outfitColor,
    pantsColor: src.pantsColor || pal.pantsColor,
    skinColor: src.skinColor || pal.skinColor,
    accessory: src.accessory || 'none',
    description: String(src.description || ''),
    defaultRoom: src.defaultRoom || 'pantry',
    targetStation: src.targetStation || 'pantry_center'
  };
}

function cmSeedRoster() {
  const list = [];
  try {
    const agents = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents) ? OFFICE_CONFIG.agents : {};
    Object.values(agents).forEach((config, index) => {
      const copy = cmDeepCopy(config);
      if (copy) list.push(cmNormalizeConfig(copy, index));
    });
  } catch (e) {}
  return list;
}

function cmLoadRoster() {
  try {
    const saved = localStorage.getItem(CHARACTER_ROSTER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {}
  return null;
}

function cmSaveRoster() {
  try {
    localStorage.setItem(CHARACTER_ROSTER_KEY, JSON.stringify(characterRoster || []));
  } catch (e) {
    cmToast('error', 'Gagal menyimpan roster karakter ke localStorage.');
  }
}

function cmEnsureOrchestrator() {
  if (!Array.isArray(characterRoster)) characterRoster = [];
  if (characterRoster.some(c => c && c.id === 'scrum_master')) return;

  const agents = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents) ? OFFICE_CONFIG.agents : null;
  const base = (agents && agents.scrum_master) ? cmDeepCopy(agents.scrum_master) : null;
  const fallback = base || {
    id: 'scrum_master',
    name: 'Citra',
    role: 'Scrum Master & Orchestrator',
    tag: 'scrum',
    color: '#f59e0b',
    emoji: '👑',
    description: 'Menganalisis user story, requirements, dan memecah task menjadi sprint backlog teknis.',
    targetStation: 'war_whiteboard'
  };
  characterRoster.unshift(cmNormalizeConfig(fallback, 0));
}

function cmLoadAgentSettings() {
  try {
    const saved = localStorage.getItem(CHARACTER_AGENT_SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {}
  return {};
}

function cmRosterIndex(agentId) {
  if (!Array.isArray(characterRoster)) return 0;
  const idx = characterRoster.findIndex(c => c && c.id === agentId);
  return idx < 0 ? 0 : idx;
}

/* ------------------------------------------------------------------ */
/* LLM bridge                                                          */
/* ------------------------------------------------------------------ */

async function cmRequestCompletion({ systemPrompt, messages, temperature, maxTokens }) {
  const messagesList = Array.isArray(messages) ? messages : [];

  // Preferred path: the shared llmClient.complete() helper (added by another workstream).
  try {
    if (typeof llmClient !== 'undefined' && llmClient && typeof llmClient.complete === 'function') {
      return await llmClient.complete({
        systemPrompt: systemPrompt,
        messages: messagesList,
        temperature: (typeof temperature === 'number') ? temperature : 0.6,
        maxTokens: (typeof maxTokens === 'number') ? maxTokens : 900
      });
    }
  } catch (err) {
    // llmClient exists but failed (e.g. missing API key) -> surface a clear message.
    throw err;
  }

  // Fallback: raw fetch using the configured client/API settings.
  const client = (typeof llmClient !== 'undefined' && llmClient) ? llmClient : null;
  const storageKeys = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.storageKeys) ? OFFICE_CONFIG.storageKeys : {};
  const defaults = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.defaults) ? OFFICE_CONFIG.defaults : {};

  const apiBase = String(
    (client && client.apiBase) ||
    localStorage.getItem(storageKeys.API_BASE) ||
    defaults.apiBase ||
    'https://openrouter.ai/api/v1'
  ).replace(/\/+$/, '');

  const apiKey = String(
    (client && client.apiKey) ||
    localStorage.getItem(storageKeys.API_KEY) ||
    ''
  ).trim();

  const model = String(
    (client && client.model) ||
    localStorage.getItem(storageKeys.MODEL) ||
    defaults.model ||
    ''
  ).trim();

  if (!apiKey) {
    throw new Error('API Key belum diisi. Atur pada tab Settings (⚙️).');
  }

  const payloadMessages = [];
  if (systemPrompt) payloadMessages.push({ role: 'system', content: systemPrompt });
  messagesList.forEach(m => payloadMessages.push(m));

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: payloadMessages,
      temperature: (typeof temperature === 'number') ? temperature : 0.6,
      max_tokens: (typeof maxTokens === 'number') ? maxTokens : 900
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = (errorData && errorData.error && errorData.error.message) ? errorData.error.message : response.statusText;
    throw new Error(`API Error (${response.status}): ${msg}`);
  }

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;

  if (!content) throw new Error('Respon API kosong atau format tidak sesuai.');
  return content;
}

function cmParseJobResult(text, entry) {
  const raw = String(text || '').trim();
  let description = raw;
  let systemPrompt = '';

  const descMatch = raw.match(/DESKRIPSI\s*[:\-]?\s*([\s\S]*?)(?=SYSTEM\s*PROMPT|$)/i);
  const sysMatch = raw.match(/SYSTEM\s*PROMPT\s*[:\-]?\s*([\s\S]+)$/i);

  if (descMatch && descMatch[1].trim()) description = descMatch[1].trim();
  if (sysMatch && sysMatch[1].trim()) systemPrompt = sysMatch[1].trim();

  if (!systemPrompt) {
    systemPrompt = `Anda adalah ${entry.name}, ${entry.role}.\n${description}`.trim();
  }
  description = cmTruncate(description.replace(/\s+/g, ' '), 600);
  if (systemPrompt.length > 4000) systemPrompt = systemPrompt.slice(0, 4000);

  return { description: description, systemPrompt: systemPrompt };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function cmBuildCard(cfg) {
  const isOrchestrator = cfg.id === 'scrum_master';
  const color = cmIsHexColor(cfg.color) ? cfg.color : '#94a3b8';
  const emoji = cfg.emoji || '🧑‍💻';
  const name = cmEscape(cfg.name);
  const role = cmEscape(cfg.role);
  const desc = cfg.description ? cmEscape(cfg.description) : '<em style="color:var(--text-muted);">Belum ada deskripsi pekerjaan.</em>';

  const settings = cmLoadAgentSettings();
  const spec = (settings[cfg.id] && typeof settings[cfg.id].customSystemPrompt === 'string')
    ? settings[cfg.id].customSystemPrompt.trim()
    : '';
  const specPreview = spec
    ? `<div class="char-desc" style="color:var(--accent-cyan);" title="${cmEscape(spec)}">🧠 Spesifikasi AI: ${cmEscape(cmTruncate(spec.replace(/\s+/g, ' '), 180))}</div>`
    : '';

  const idArg = cmEscape(cfg.id);
  const removeButton = isOrchestrator
    ? `<span class="btn-xs" style="cursor:default;opacity:0.7;" title="Scrum Master adalah orkestrator dan tidak dapat dihapus">🔒 Orkestrator</span>`
    : `<button type="button" class="btn-xs danger" onclick="removeCharacter('${idArg}')">🗑️ Hapus</button>`;

  return `
    <div class="character-card" style="border-left-color:${color};">
      <span class="char-emoji">${cmEscape(emoji)}</span>
      <div class="char-info">
        <div class="char-name">${name}${isOrchestrator ? ' <span style="font-size:9px;color:#f59e0b;">• ORCHESTRATOR</span>' : ''}</div>
        <div class="char-role">${role}${cfg.tag ? ` • #${cmEscape(cfg.tag)}` : ''}</div>
        <div class="char-desc">${desc}</div>
        ${specPreview}
      </div>
      <div class="task-actions" style="flex-direction:column;gap:6px;align-items:stretch;flex-shrink:0;">
        <button type="button" class="btn-xs" onclick="editCharacter('${idArg}')">✏️ Edit</button>
        <button type="button" class="btn-xs" onclick="generateCharacterJob('${idArg}')">🧠 Generate Pekerjaan (AI)</button>
        ${removeButton}
      </div>
    </div>`;
}

function cmFormHtml() {
  return `
    <div class="card-section" style="margin-top:16px;">
      <div class="card-title">
        <span class="card-title-text" id="characterFormTitle">➕ Tambah Karakter</span>
      </div>
      <form id="characterForm" autocomplete="off" novalidate>
        <div class="form-group">
          <label class="form-label" for="charFormName">Nama Karakter</label>
          <input class="form-input" type="text" id="charFormName" placeholder="cth: Andi" />
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1;">
            <label class="form-label" for="charFormRole">Role / Pekerjaan</label>
            <input class="form-input" type="text" id="charFormRole" placeholder="cth: DevOps Engineer" />
          </div>
          <div class="form-group" style="width:110px;">
            <label class="form-label" for="charFormEmoji">Emoji</label>
            <input class="form-input" type="text" id="charFormEmoji" placeholder="🧑‍💻" maxlength="8" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="width:150px;">
            <label class="form-label" for="charFormColor">Warna Aksen</label>
            <input class="form-input" type="color" id="charFormColor" value="#6366f1" style="height:38px;padding:4px;" />
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label" for="charFormColorHex">Hex Warna (opsional)</label>
            <input class="form-input" type="text" id="charFormColorHex" placeholder="#6366f1" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1;">
            <label class="form-label" for="charFormTag">Tag</label>
            <input class="form-input" type="text" id="charFormTag" placeholder="cth: devops" />
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label" for="charFormTargetStation">Target Station (waypoint)</label>
            <input class="form-input" type="text" id="charFormTargetStation" placeholder="pantry_center" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="charFormDescription">Deskripsi Pekerjaan</label>
          <textarea class="form-textarea" id="charFormDescription" rows="3" placeholder="Tugas dan tanggung jawab karakter ini..."></textarea>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <input type="checkbox" id="charFormGenerateAI" />
          <label class="form-label" for="charFormGenerateAI" style="margin:0;cursor:pointer;">Generate pekerjaan dengan AI</label>
        </div>
        <div class="form-row" style="align-items:center;">
          <button class="btn-primary" type="submit" id="charFormSubmitBtn">➕ Tambah Karakter</button>
          <button class="btn-secondary" type="button" id="charFormCancelBtn" onclick="cancelCharacterEdit()" style="display:none;flex:0 0 auto;">✖ Batal Edit</button>
        </div>
      </form>
    </div>`;
}

function renderCharacterPage() {
  const container = document.getElementById('characterPageContainer');
  if (!container) return;

  try {
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();
    cmEnsureOrchestrator();

    const cards = characterRoster.map(cfg => cmBuildCard(cmNormalizeConfig(cfg, cmRosterIndex(cfg.id)))).join('');

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--text-muted);">
          ${characterRoster.length} karakter pada roster • tersimpan di localStorage ('${CHARACTER_ROSTER_KEY}')
        </div>
        <button type="button" class="btn-secondary" style="flex:0 0 auto;" onclick="applyRoster()">🔄 Terapkan Roster</button>
      </div>
      <div class="character-roster-list">${cards}</div>
      ${cmFormHtml()}`;

    // Bind the add/edit form.
    const form = document.getElementById('characterForm');
    if (form) form.addEventListener('submit', handleCharacterFormSubmit);

    // Keep the color picker and the hex text field in sync.
    const colorInput = document.getElementById('charFormColor');
    const hexInput = document.getElementById('charFormColorHex');
    if (colorInput && hexInput) {
      colorInput.addEventListener('input', () => {
        hexInput.value = colorInput.value;
      });
      hexInput.addEventListener('input', () => {
        const value = hexInput.value.trim();
        if (cmIsHexColor(value)) colorInput.value = value;
      });
    }

    // Restore edit mode UI if an edit is in progress.
    if (characterEditingId) {
      const entry = characterRoster.find(c => c && c.id === characterEditingId);
      if (entry) cmFillForm(entry); else characterEditingId = null;
    }
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:16px;color:#f87171;font-size:11px;">Gagal memuat daftar karakter: ${cmEscape(err && err.message)}</div>`;
  }
}

function cmFillForm(entry) {
  cmSetVal('charFormName', entry.name);
  cmSetVal('charFormRole', entry.role);
  cmSetVal('charFormEmoji', entry.emoji || '');
  cmSetVal('charFormTag', entry.tag || '');
  cmSetVal('charFormTargetStation', entry.targetStation || '');
  cmSetVal('charFormDescription', entry.description || '');
  const color = cmIsHexColor(entry.color) ? entry.color : '#6366f1';
  cmSetVal('charFormColorHex', color);
  const colorInput = document.getElementById('charFormColor');
  if (colorInput) colorInput.value = color;

  const title = document.getElementById('characterFormTitle');
  if (title) title.textContent = `✏️ Edit Karakter: ${entry.name}`;
  const submitBtn = document.getElementById('charFormSubmitBtn');
  if (submitBtn) submitBtn.textContent = '💾 Simpan Perubahan';
  const cancelBtn = document.getElementById('charFormCancelBtn');
  if (cancelBtn) cancelBtn.style.display = '';
}

/* ------------------------------------------------------------------ */
/* World reconciliation                                                */
/* ------------------------------------------------------------------ */

function rebuildAgentsQuickBar() {
  const bar = document.getElementById('agentsQuickBar');
  if (!bar || !Array.isArray(characterRoster)) return;

  bar.innerHTML = characterRoster.map(cfg => {
    const color = cmIsHexColor(cfg.color) ? cfg.color : '#94a3b8';
    const badgeClass = String(cfg.tag || '').replace(/[^a-z0-9_-]/gi, '');
    const id = cmEscape(cfg.id);
    return `
      <div class="agent-pill ${badgeClass}" data-agent="${id}" title="Klik untuk interaksi dengan ${cmEscape(cfg.name)}" style="--role-color:${color};">
        <span class="agent-icon">${cmEscape(cfg.emoji || '🧑‍💻')}</span>
        <span class="agent-identity">
          <span class="agent-name" id="hud_name_${id}">${cmEscape(cfg.name)}</span>
          <span class="agent-role" id="hud_role_${id}">${cmEscape(cmShortRole(cfg))}</span>
        </span>
        <span class="agent-status-tag" id="status_${id}">IDLE</span>
      </div>`;
  }).join('');

  // Same click-to-follow behaviour app.js wires on the initial pills.
  bar.querySelectorAll('.agent-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const agentId = pill.getAttribute('data-agent');
      const live = cmGetCharacters();
      const agent = live ? live[agentId] : null;
      if (!agent) return;

      try { if (typeof soundFx !== 'undefined' && soundFx) soundFx.playClick(); } catch (e) {}

      const r = cmGetRenderer();
      if (!r) return;
      const camera = r.camera || {};
      if (camera.followingAgent === agent) {
        if (typeof r.resetCamera === 'function') r.resetCamera();
      } else if (typeof r.followAgent === 'function') {
        r.followAgent(agent);
        try {
          if (typeof agent.say === 'function') {
            agent.say(`Halo! Saya ${agent.name}, status: ${agent.state}`, 200);
          }
        } catch (e) {}
      }
    });
  });
}

function applyRoster(options) {
  let opts = options;
  if (opts && typeof opts.preventDefault === 'function') opts = {}; // called from an event handler
  if (!opts || typeof opts !== 'object') opts = {};

  try {
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();
    cmEnsureOrchestrator();
    cmSaveRoster();

    const agents = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents) ? OFFICE_CONFIG.agents : null;
    const live = cmGetCharacters();
    const rosterIds = new Set(characterRoster.map(c => c && c.id).filter(Boolean));

    // 1. Drop characters that are no longer part of the roster.
    if (live) {
      Object.keys(live).forEach(key => {
        if (!rosterIds.has(key)) {
          try { delete live[key]; } catch (e) { live[key] = undefined; }
        }
      });
    }

    // 2. Upsert every roster entry into OFFICE_CONFIG.agents and the live world.
    characterRoster.forEach((entry, index) => {
      const config = cmNormalizeConfig(entry, index);

      if (agents) {
        agents[config.id] = Object.assign({}, agents[config.id] || {}, config);
      }

      if (!live) return;
      const existing = live[config.id];
      if (!existing) {
        try {
          live[config.id] = new AgentCharacter(config, 'pantry_center');
        } catch (e) {
          cmToast('error', `Gagal menambahkan karakter "${config.name}" ke dunia.`);
        }
      } else {
        // Refresh the live instance so edits show up without a full rebuild.
        try {
          existing.name = config.name;
          existing.fullName = config.fullName;
          existing.role = config.role;
          existing.tag = config.tag;
          existing.color = config.color;
          existing.emoji = config.emoji;
          existing.hairColor = config.hairColor;
          existing.outfitColor = config.outfitColor;
          existing.pantsColor = config.pantsColor;
          existing.skinColor = config.skinColor;
          existing.accessory = config.accessory;
          existing.defaultRoom = config.defaultRoom;
          existing.targetStation = config.targetStation;
        } catch (e) {}
      }
    });

    // 3. Keep sprintManager.characters in sync (normally the same object reference).
    try {
      if (typeof sprintManager !== 'undefined' && sprintManager && sprintManager.characters && live && sprintManager.characters !== live) {
        Object.keys(sprintManager.characters).forEach(key => {
          if (!rosterIds.has(key)) delete sprintManager.characters[key];
        });
        characterRoster.forEach(entry => {
          if (live[entry.id]) sprintManager.characters[entry.id] = live[entry.id];
        });
      }
    } catch (e) {}

    // 4. Rebuild the HUD quick bar from the roster.
    rebuildAgentsQuickBar();

    if (!opts.silent) {
      cmToast('success', 'Roster karakter diterapkan. Refresh halaman jika perlu.');
    }
  } catch (err) {
    cmToast('error', `Gagal menerapkan roster: ${(err && err.message) || err}`);
  }
}

/* ------------------------------------------------------------------ */
/* UI actions (exposed globally so inline handlers can call them)      */
/* ------------------------------------------------------------------ */

function editCharacter(agentId) {
  try {
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();
    const entry = characterRoster.find(c => c && c.id === agentId);
    if (!entry) {
      cmToast('error', 'Karakter tidak ditemukan.');
      return;
    }

    // Make sure the form exists (page might not have been rendered yet).
    if (!document.getElementById('characterForm')) renderCharacterPage();

    characterEditingId = agentId;
    cmFillForm(entry);

    const form = document.getElementById('characterForm');
    if (form && typeof form.scrollIntoView === 'function') {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    cmToast('info', `Mode edit: ${entry.name}. Ubah data lalu simpan.`);
  } catch (err) {
    cmToast('error', `Gagal membuka editor: ${(err && err.message) || err}`);
  }
}

function cancelCharacterEdit() {
  try {
    characterEditingId = null;
    const form = document.getElementById('characterForm');
    if (form) form.reset();
    const colorInput = document.getElementById('charFormColor');
    if (colorInput) colorInput.value = '#6366f1';
    cmSetVal('charFormColorHex', '');
    const title = document.getElementById('characterFormTitle');
    if (title) title.textContent = '➕ Tambah Karakter';
    const submitBtn = document.getElementById('charFormSubmitBtn');
    if (submitBtn) submitBtn.textContent = '➕ Tambah Karakter';
    const cancelBtn = document.getElementById('charFormCancelBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    cmToast('info', 'Mode edit dibatalkan.');
  } catch (err) {
    // Never throw out of a UI handler.
  }
}

async function handleCharacterFormSubmit(event) {
  try {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();

    const name = cmVal('charFormName');
    const role = cmVal('charFormRole');
    if (!name) { cmToast('error', 'Nama karakter wajib diisi.'); return; }
    if (!role) { cmToast('error', 'Role / pekerjaan wajib diisi.'); return; }

    const emoji = cmVal('charFormEmoji') || '🧑‍💻';
    let color = cmVal('charFormColorHex');
    if (!cmIsHexColor(color)) {
      const picker = document.getElementById('charFormColor');
      color = (picker && cmIsHexColor(picker.value)) ? picker.value : '#6366f1';
    }
    const tag = cmVal('charFormTag') || cmSlugifyId(role).split('_')[0] || 'team';
    const targetStation = cmVal('charFormTargetStation') || 'pantry_center';
    const description = cmVal('charFormDescription');
    const wantAI = cmChecked('charFormGenerateAI');

    let targetId;
    if (characterEditingId) {
      const entry = characterRoster.find(c => c && c.id === characterEditingId);
      if (!entry) {
        characterEditingId = null;
        renderCharacterPage();
        cmToast('error', 'Karakter yang diedit tidak ditemukan.');
        return;
      }
      Object.assign(entry, cmNormalizeConfig(Object.assign({}, entry, {
        name: name,
        role: role,
        emoji: emoji,
        color: color,
        tag: tag,
        targetStation: targetStation,
        description: description,
        fullName: `${name} (${role})`,
        accentBg: cmHexToRgba(color, 0.2),
        borderColor: color,
        badgeClass: tag
      }), cmRosterIndex(entry.id)));
      targetId = entry.id;
      cmToast('success', `Karakter "${name}" berhasil diperbarui.`);
    } else {
      const id = cmUniqueId(cmSlugifyId(name));
      const newEntry = cmNormalizeConfig({
        id: id,
        name: name,
        role: role,
        emoji: emoji,
        color: color,
        tag: tag,
        targetStation: targetStation,
        description: description
      }, characterRoster.length);
      characterRoster.push(newEntry);
      targetId = id;
      cmToast('success', `Karakter "${name}" berhasil ditambahkan.`);
    }

    characterEditingId = null;
    cmSaveRoster();
    applyRoster({ silent: true });
    renderCharacterPage();

    if (wantAI) await generateCharacterJob(targetId);
  } catch (err) {
    cmToast('error', `Gagal menyimpan karakter: ${(err && err.message) || err}`);
  }
}

function removeCharacter(agentId) {
  try {
    if (agentId === 'scrum_master') {
      cmToast('error', 'Scrum Master adalah orkestrator dan tidak dapat dihapus.');
      return;
    }
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();
    const entry = characterRoster.find(c => c && c.id === agentId);
    if (!entry) return;

    if (typeof confirm === 'function' && !confirm(`Hapus karakter "${entry.name}" dari roster?`)) return;

    characterRoster = characterRoster.filter(c => c && c.id !== agentId);
    if (characterEditingId === agentId) characterEditingId = null;

    cmSaveRoster();
    applyRoster({ silent: true });
    renderCharacterPage();
    cmToast('success', `Karakter "${entry.name}" dihapus dari roster.`);
  } catch (err) {
    cmToast('error', `Gagal menghapus karakter: ${(err && err.message) || err}`);
  }
}

async function generateCharacterJob(agentId) {
  try {
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();
    const entry = characterRoster.find(c => c && c.id === agentId);
    if (!entry) {
      cmToast('error', 'Karakter tidak ditemukan.');
      return;
    }

    cmToast('info', `🧠 AI sedang menyusun deskripsi pekerjaan untuk ${entry.name}...`);

    const systemPrompt = 'Kamu adalah perancang peran tim software. Buatkan deskripsi pekerjaan (Bahasa Indonesia) dan system prompt teknis singkat untuk sebuah karakter tim.';
    const userPrompt = `Buatkan deskripsi pekerjaan (Bahasa Indonesia) dan system prompt teknis singkat untuk karakter bernama ${entry.name} dengan role ${entry.role}.` +
      (entry.description ? ` Deskripsi awal: ${entry.description}` : '') +
      '\n\nBalas PERSIS dengan format berikut:\nDESKRIPSI: <satu paragraf deskripsi pekerjaan>\nSYSTEM PROMPT: <instruksi teknis singkat untuk agen AI ini>';

    const text = await cmRequestCompletion({
      systemPrompt: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.6,
      maxTokens: 900
    });

    const parsed = cmParseJobResult(text, entry);

    // Update the roster description.
    entry.description = parsed.description;
    cmSaveRoster();

    // Merge the generated technical spec into voffice_agent_settings[agentId].
    const settings = cmLoadAgentSettings();
    const previous = (settings[agentId] && typeof settings[agentId] === 'object') ? settings[agentId] : {};
    settings[agentId] = Object.assign({}, previous, { customSystemPrompt: parsed.systemPrompt });
    try {
      localStorage.setItem(CHARACTER_AGENT_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      throw new Error('Gagal menyimpan hasil AI ke localStorage.');
    }

    // Reflect the new description/spec in the world and the cards.
    applyRoster({ silent: true });
    renderCharacterPage();
    cmToast('success', `🧠 Deskripsi pekerjaan ${entry.name} berhasil dibuat AI.`);
  } catch (err) {
    cmToast('error', `Gagal generate pekerjaan: ${(err && err.message) || err}`);
  }
}

/* ------------------------------------------------------------------ */
/* Entry point (called by app.js on DOMContentLoaded)                  */
/* ------------------------------------------------------------------ */

function initCharacterPage() {
  const container = document.getElementById('characterPageContainer');
  if (!container) return;

  try {
    if (!Array.isArray(characterRoster)) characterRoster = cmLoadRoster() || cmSeedRoster();
    cmEnsureOrchestrator();
    cmSaveRoster();

    // Reconcile the live world (restores AI-added characters after a refresh,
    // and re-applies any edited names/roles/colors).
    applyRoster({ silent: true });
    renderCharacterPage();
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:16px;color:#f87171;font-size:11px;">Gagal memuat daftar karakter: ${cmEscape(err && err.message)}</div>`;
  }
}

// Expose the public API on window so inline onclick handlers always resolve.
if (typeof window !== 'undefined') {
  window.initCharacterPage = initCharacterPage;
  window.renderCharacterPage = renderCharacterPage;
  window.applyRoster = applyRoster;
  window.generateCharacterJob = generateCharacterJob;
  window.handleCharacterFormSubmit = handleCharacterFormSubmit;
  window.editCharacter = editCharacter;
  window.cancelCharacterEdit = cancelCharacterEdit;
  window.removeCharacter = removeCharacter;
}

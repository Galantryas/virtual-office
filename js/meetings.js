/**
 * 2D Virtual Dev Office - Meetings Module
 * Weekly retro meeting + AI self-upgrade meeting. Notes are persisted as .md files.
 *
 * Public API (bound from index.html):
 *   - runWeeklyMeetingFromUI()  -> full team retro meeting, saves minutes to meetings/
 *   - runUpgradeMeetingFromUI() -> AI proposes system improvements + new backlog tasks
 *   - refreshMeetingsList()     -> list saved .md notes for the active project
 */

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

// Meeting seats in the war room. Non-Daisy characters get distinct seats.
const MEETING_SEATS = [
  'war_table_head',
  'war_table_seat1',
  'war_table_seat2',
  'war_table_seat3',
  'war_whiteboard'
];

// Pantry waypoints fallback (mirrors SprintManager.sendAllAgentsToPantry).
const PANTRY_WAYPOINTS = [
  'pantry_coffee_machine',
  'pantry_sofa_left',
  'pantry_sofa_right',
  'pantry_table',
  'pantry_water',
  'pantry_center'
];

// Short Indonesian one-liners said by each agent when the meeting starts.
const MEETING_LINES = {
  scrum_master: 'Baik, rapat mingguan kita mulai! 📋',
  system_architect: 'Arsitektur aman, siap evaluasi. 🗄️',
  backend_dev: 'Backend sudah saya rapikan. 💻',
  frontend_dev: 'UI mulus, lanjut bahas idealnya. ✨',
  qa_engineer: 'Semua temuan QA saya laporkan ya. 🛡️',
  daisy: 'Saya catat semua notulen rapat ini! 🛎️'
};

// Get the live characters dictionary (app.js global) with a safe fallback.
function _getCharacters() {
  if (typeof characters !== 'undefined' && characters && typeof characters === 'object') {
    return characters;
  }
  if (typeof sprintManager !== 'undefined' && sprintManager && sprintManager.characters) {
    return sprintManager.characters;
  }
  return {};
}

// Get the active project object (or null).
function _getActiveProject() {
  if (typeof sprintManager === 'undefined' || !sprintManager || typeof sprintManager.getActiveProject !== 'function') {
    return null;
  }
  try {
    return sprintManager.getActiveProject();
  } catch (e) {
    return null;
  }
}

// Resolve the active project's filesystem path (or empty string).
function _getActiveProjectPath() {
  const proj = _getActiveProject();
  return (proj && proj.path) ? proj.path : '';
}

// Safe toast wrapper (never throws).
function _toast(type, message) {
  if (typeof showToast === 'function') {
    try { showToast(type, message); } catch (e) { /* ignore */ }
  }
}

// Safe HTML escape wrapper.
function _esc(str) {
  if (typeof escapeHtml === 'function') {
    try { return escapeHtml(String(str == null ? '' : str)); } catch (e) { /* ignore */ }
  }
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Safe sound helper.
function _playBell() {
  try {
    if (typeof soundFx !== 'undefined' && soundFx && typeof soundFx.playBell === 'function') {
      soundFx.playBell();
    }
  } catch (e) { /* ignore */ }
}

// Indonesian date string (best effort).
function _formatDate(d) {
  try {
    return (d || new Date()).toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch (e) {
    return String(new Date());
  }
}

// Pretty-print a byte size.
function _formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Pretty-print a mtime (ms) value.
function _formatMtime(mtime) {
  try {
    const d = new Date(Number(mtime) || Date.now());
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return '';
  }
}

// POST JSON helper with graceful JSON parsing.
async function _postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Server error ${res.status}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// LLM calling (prefers llmClient.complete, falls back to a direct fetch).
// ---------------------------------------------------------------------------
async function _vofficeChat({ systemPrompt, messages, model, temperature = 0.4, maxTokens = 2000 }) {
  if (typeof llmClient !== 'undefined' && llmClient &&
      typeof llmClient.complete === 'function') {
    return llmClient.complete({ systemPrompt, messages, model, temperature, maxTokens });
  }

  const key = (typeof llmClient !== 'undefined' && llmClient) ? llmClient.apiKey : '';
  if (!key) throw new Error('API Key belum diisi di Settings.');
  const base = ((typeof llmClient !== 'undefined' && llmClient && llmClient.apiBase) || '').replace(/\/+$/, '');
  const useModel = model || (typeof llmClient !== 'undefined' && llmClient ? llmClient.model : '');
  const payload = {
    model: useModel,
    messages: [{ role: 'system', content: systemPrompt }, ...(messages || [])],
    temperature,
    max_tokens: maxTokens
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `API Error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Check that an API key is configured (llmClient or localStorage).
function _hasApiKey() {
  try {
    if (typeof llmClient !== 'undefined' && llmClient && llmClient.apiKey) return true;
  } catch (e) { /* ignore */ }
  try {
    if (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.storageKeys) {
      return !!localStorage.getItem(OFFICE_CONFIG.storageKeys.API_KEY);
    }
    return !!localStorage.getItem('voffice_api_key');
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Character choreography
// ---------------------------------------------------------------------------

// Move the dev team to distinct war-room seats and let them greet.
function _seatAgentsForMeeting() {
  const chars = _getCharacters();
  const devKeys = Object.keys(chars).filter(k => k !== 'daisy');
  let seatIdx = 0;
  devKeys.forEach(key => {
    const agent = chars[key];
    if (!agent || typeof agent.moveToWaypoint !== 'function') return;
    const seat = MEETING_SEATS[seatIdx % MEETING_SEATS.length];
    seatIdx++;
    try {
      agent.moveToWaypoint(seat, () => {
        agent.state = 'MEETING';
        if (typeof agent.say === 'function') {
          agent.say(MEETING_LINES[key] || 'Siap mengikuti rapat mingguan! 📋', 260);
        }
      });
      // Set state right away too, so the badge reflects the intent while walking.
      agent.state = 'MEETING';
    } catch (e) { /* ignore single agent failure */ }
  });

  _playBell();
}

// Send everyone back home after the meeting (~6s later).
function _dismissAgentsFromMeeting() {
  if (typeof sprintManager !== 'undefined' && sprintManager &&
      typeof sprintManager.sendAllAgentsToPantry === 'function') {
    try {
      sprintManager.sendAllAgentsToPantry();
      return;
    } catch (e) { /* fall through to local fallback */ }
  }

  const chars = _getCharacters();
  let idx = 0;
  Object.keys(chars).forEach(key => {
    const agent = chars[key];
    if (!agent) return;
    agent.state = 'IDLE';
    if (typeof agent.moveToWaypoint !== 'function') return;
    try {
      if (key === 'daisy') {
        agent.moveToWaypoint('reception_chair');
      } else {
        agent.moveToWaypoint(PANTRY_WAYPOINTS[idx % PANTRY_WAYPOINTS.length]);
        idx++;
      }
    } catch (e) { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

// Compact description of the current week's tasks.
function _buildTaskContext() {
  if (typeof sprintManager === 'undefined' || !sprintManager) return '(tidak ada data sprint)';
  let tasks = [];
  try {
    tasks = (typeof sprintManager.getWeekTasks === 'function') ? (sprintManager.getWeekTasks() || []) : (sprintManager.tasks || []);
  } catch (e) {
    tasks = [];
  }
  if (!tasks.length) return '(belum ada task pada minggu ini)';
  return tasks.map((t, i) => {
    const agent = t.activeAgent || '-';
    return `${i + 1}. "${t.title}" | status: ${t.status || 'PENDING'} | prioritas: ${t.priority || 3} | agent: ${agent}`;
  }).join('\n');
}

// Compact description of the last ~30 chat log entries.
function _buildChatContext(limit = 30) {
  if (typeof sprintManager === 'undefined' || !sprintManager || !Array.isArray(sprintManager.chatLog)) {
    return '(tidak ada riwayat chat)';
  }
  const logs = sprintManager.chatLog.slice(-limit);
  if (!logs.length) return '(tidak ada riwayat chat)';
  return logs.map(l => {
    const who = l.senderName || l.agentKey || 'System';
    const title = l.title ? `${l.title}: ` : '';
    const text = (l.text || '').replace(/\s+/g, ' ').slice(0, 220);
    return `[${l.timestamp || ''}] ${who} — ${title}${text}`;
  }).join('\n');
}

// Attendee list derived from the registered agents.
function _buildAttendees() {
  if (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents) {
    const names = Object.keys(OFFICE_CONFIG.agents).map(k => {
      const a = OFFICE_CONFIG.agents[k];
      return a.fullName || a.name || k;
    });
    if (names.length) return names.join(', ');
  }
  const chars = _getCharacters();
  const names = Object.keys(chars).map(k => chars[k].fullName || chars[k].name || k);
  return names.length ? names.join(', ') : 'Tim Virtual Office';
}

// ---------------------------------------------------------------------------
// Tolerant JSON extraction (find the LAST ```json ... ``` block)
// ---------------------------------------------------------------------------
function _extractJsonBlock(raw) {
  const text = String(raw || '');
  const fenceRe = /```json\s*([\s\S]*?)```/gi;
  let match = null;
  let last = null;
  while ((match = fenceRe.exec(text)) !== null) {
    last = match[1];
  }
  let candidate = last;
  if (!candidate) {
    // Fall back to the last top-level [...] block in the text.
    const start = text.lastIndexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) candidate = text.substring(start, end + 1);
  }
  if (!candidate) return null;
  try {
    return JSON.parse(candidate.trim());
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Notes persistence helpers
// ---------------------------------------------------------------------------
async function _writeNote(projectPath, fileName, content) {
  return _postJson('/api/notes/write', {
    projectPath: projectPath,
    subdir: 'meetings',
    fileName: fileName,
    content: content
  });
}

async function _readProjectFile(projectPath, filePath) {
  try {
    const data = await _postJson('/api/project/read', { projectPath, filePath });
    if (data && data.success && typeof data.content === 'string') return data.content;
  } catch (e) { /* best effort */ }
  return '';
}

// ---------------------------------------------------------------------------
// Task 14 — Weekly Meeting
// ---------------------------------------------------------------------------
async function runWeeklyMeetingFromUI() {
  try {
    const projectPath = _getActiveProjectPath();
    if (!projectPath) {
      _toast('error', 'Tidak ada proyek aktif.');
      return;
    }
    if (!_hasApiKey()) {
      _toast('error', 'API Key belum diisi di Settings.');
      return;
    }

    const week = (typeof sprintManager !== 'undefined' && sprintManager && sprintManager.currentWeek) || 1;

    // Bring the team into the war room while the LLM thinks.
    _seatAgentsForMeeting();
    _toast('info', '📅 Weekly meeting dimulai...');

    const taskContext = _buildTaskContext();
    const chatContext = _buildChatContext(30);
    const attendees = _buildAttendees();
    const today = _formatDate(new Date());

    const systemPrompt = [
      'Kamu adalah notulis profesional untuk sebuah tim pengembang perangkat lunak virtual.',
      'Tulis notulen rapat mingguan (weekly meeting) dalam Bahasa Indonesia yang jelas dan ringkas.',
      'Balas HANYA dengan Markdown, tanpa penjelasan pembuka atau penutup.'
    ].join(' ');

    const userPrompt = [
      `Buat notulen Markdown untuk WEEKLY MEETING Sprint Minggu ke-${week}.`,
      '',
      `Tanggal: ${today}`,
      `Peserta: ${attendees}`,
      '',
      '## Task Sprint Minggu Ini',
      taskContext,
      '',
      '## Ringkasan Log Aktivitas Terakhir',
      chatContext,
      '',
      'Susun notulen dengan struktur Markdown PERSIS seperti ini (heading H1/H2):',
      '',
      `# Notulen Weekly Meeting — Sprint Minggu ${week}`,
      `**Tanggal:** ${today}`,
      `**Peserta:** ${attendees}`,
      '',
      '## Catatan per Peran',
      'Untuk SETIAP peran (Scrum Master, System Architect, Backend Developer, Frontend Developer, QA Engineer), tuliskan 3 poin:',
      '1. **Apa yang sudah selesai** — capaian pada sprint minggu ini.',
      '2. **Apa yang perlu diperbaiki** — kendala, bug, atau area yang perlu ditingkatkan.',
      '3. **Apa yang perlu diingat untuk sprint berikutnya** — catatan/pengingat penting.',
      '',
      '## Perbaikan / Action Items',
      'Daftar action items berformat checkbox, sertakan penanggung jawab bila relevan.',
      '',
      '## Catatan Penting',
      'Poin-poin penting yang wajib diingat tim.'
    ].join('\n');

    const markdown = await _vofficeChat({
      systemPrompt: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.4,
      maxTokens: 2200
    });

    const fileName = `sprint-week-${week}-weekly-meeting.md`;
    const writeResult = await _writeNote(projectPath, fileName, markdown || '');
    if (!writeResult || !writeResult.success) {
      throw new Error((writeResult && writeResult.error) || 'Gagal menyimpan notulen.');
    }

    // Post a short entry into the live chat stream.
    _addMeetingChatLog('📅 Weekly Meeting', `Notulen Sprint Minggu ${week} telah dibuat dan disimpan sebagai ${fileName}.`);

    // Wrap up: everyone back to the pantry after ~6 seconds.
    setTimeout(() => {
      try { _dismissAgentsFromMeeting(); } catch (e) { /* ignore */ }
    }, 6000);

    _toast('success', '✅ Notulen weekly meeting disimpan.');
    refreshMeetingsList();
  } catch (err) {
    _toast('error', (err && err.message) ? err.message : 'Terjadi kesalahan saat weekly meeting.');
  }
}

// ---------------------------------------------------------------------------
// Task 15 — AI Upgrade Meeting
// ---------------------------------------------------------------------------
async function runUpgradeMeetingFromUI() {
  try {
    const projectPath = _getActiveProjectPath();
    if (!projectPath) {
      _toast('error', 'Tidak ada proyek aktif.');
      return;
    }
    if (!_hasApiKey()) {
      _toast('error', 'API Key belum diisi di Settings.');
      return;
    }

    _toast('info', '🧠 AI upgrade meeting sedang menganalisis sistem...');

    // Best-effort project context.
    const readme = await _readProjectFile(projectPath, 'README.md');
    const todo = await _readProjectFile(projectPath, 'To Do.txt');

    const week = (typeof sprintManager !== 'undefined' && sprintManager && sprintManager.currentWeek) || 1;
    const taskContext = _buildTaskContext();
    const today = _formatDate(new Date());

    const systemPrompt = [
      'Kamu adalah AI Lead Engineer yang bertugas mengusulkan perbaikan sistem dan task baru.',
      'Jawab dalam Bahasa Indonesia. Balas dengan Markdown untuk retro, lalu SATU blok ```json berisi daftar task usulan.'
    ].join(' ');

    const userPrompt = [
      `Lakukan AI UPGRADE MEETING untuk Sprint Minggu ke-${week}. Tinjau kondisi sistem dan usulkan perbaikan.`,
      '',
      `Tanggal: ${today}`,
      '',
      '### Task Sprint Saat Ini',
      taskContext,
      '',
      '### Isi README.md',
      (readme ? readme.slice(0, 6000) : '(tidak tersedia)'),
      '',
      '### Isi To Do.txt',
      (todo ? todo.slice(0, 6000) : '(tidak tersedia)'),
      '',
      'BAGIAN 1 — Tulis retro/ide singkat dalam Markdown (heading + bullet): apa yang bisa di-upgrade,',
      'utang teknis, dan peluang peningkatan kualitas/keamanan/UX.',
      '',
      'BAGIAN 2 — Setelah retro, tulis SATU blok ```json berisi array task BARU yang diusulkan, contoh:',
      '```json',
      '[',
      '  {"title": "Judul task singkat", "description": "Deskripsi tugas yang bisa dikerjakan agen", "priority": 2, "reason": "Alasan usulan"}',
      ']',
      '```',
      'Aturan: priority berupa angka 1-4 (1=Critical, 2=High, 3=Medium, 4=Low). Maksimal 6 usulan.',
      'Hanya usulkan task yang benar-benar baru dan belum ada di sprint saat ini.'
    ].join('\n');

    const raw = await _vofficeChat({
      systemPrompt: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.5,
      maxTokens: 2400
    });

    // (a) Save the retro Markdown (strip the trailing JSON block for cleanliness).
    let retro = String(raw || '');
    const lastFence = retro.lastIndexOf('```json');
    if (lastFence !== -1) retro = retro.slice(0, lastFence).trim();
    if (!retro) retro = `# AI Upgrade Meeting — Sprint Minggu ${week}\n\n_Dokumen retro kosong._`;

    try {
      await _writeNote(projectPath, 'ai-upgrade-meeting.md', retro);
    } catch (e) {
      // Saving the note is best-effort; proposals are still useful.
    }

    // (b) Parse and render proposals.
    const proposals = _extractJsonBlock(raw);
    _renderUpgradeProposals(Array.isArray(proposals) ? proposals : []);

    _addMeetingChatLog('🧠 AI Upgrade Meeting', `AI menganalisis sistem dan mengusulkan ${Array.isArray(proposals) ? proposals.length : 0} task baru untuk Sprint Minggu berikutnya.`);

    _toast('success', '✅ AI upgrade meeting selesai. Tinjau usulan task di bawah.');
    refreshMeetingsList();
  } catch (err) {
    _toast('error', (err && err.message) ? err.message : 'Terjadi kesalahan saat AI upgrade meeting.');
  }
}

// Add a chat log entry via sprintManager (never throws).
function _addMeetingChatLog(title, text) {
  if (typeof sprintManager !== 'undefined' && sprintManager && typeof sprintManager.addChatLog === 'function') {
    try {
      sprintManager.addChatLog('system', 'System', title, text);
    } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Upgrade proposals UI
// ---------------------------------------------------------------------------

// Ensure the proposals container exists inside the meetings page.
function _ensureProposalsContainer() {
  let container = document.getElementById('upgradeProposalsContainer');
  if (container) return container;

  const page = document.getElementById('page-meetings');
  if (!page) return null;

  container = document.createElement('div');
  container.id = 'upgradeProposalsContainer';
  container.className = 'card-section';
  container.style.display = 'none';
  container.innerHTML = '<div class="card-title" style="margin-bottom: 8px;">🧠 Usulan Task dari AI</div>' +
    '<div id="upgradeProposalsList"></div>';

  // Prefer inserting after the last card-section in the page.
  const sections = page.querySelectorAll('.page-inner > .card-section');
  const listSection = document.getElementById('meetingsListContainer');
  const listCard = listSection ? listSection.closest('.card-section') : null;
  const anchor = listCard || (sections.length ? sections[sections.length - 1] : null);
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(container, anchor.nextSibling);
  } else {
    const inner = page.querySelector('.page-inner') || page;
    inner.appendChild(container);
  }
  return container;
}

// Compute the next sprint week number without switching the current week.
function _nextWeekNumber() {
  let weeks = [];
  if (typeof sprintManager !== 'undefined' && sprintManager && Array.isArray(sprintManager.weeks)) {
    weeks = sprintManager.weeks.filter(w => Number.isFinite(Number(w))).map(Number);
  }
  if (!weeks.length) {
    const cur = (typeof sprintManager !== 'undefined' && sprintManager && sprintManager.currentWeek) || 1;
    weeks = [cur];
  }
  return Math.max(...weeks) + 1;
}

// Accept one proposal -> add it to the next week's backlog.
function _acceptProposal(proposal, nextWeek) {
  if (typeof sprintManager === 'undefined' || !sprintManager || typeof sprintManager.addTask !== 'function') return;
  const title = String(proposal.title || '').trim();
  if (!title) return;
  const description = String(proposal.description || proposal.reason || '').trim();
  let priority = parseInt(proposal.priority, 10);
  if (!Number.isFinite(priority) || priority < 1 || priority > 4) priority = 3;
  try {
    sprintManager.addTask(title, description, priority, nextWeek);
  } catch (e) { /* ignore */ }
}

// Render proposals with per-item Terima/Tolak + Terima Semua buttons.
function _renderUpgradeProposals(proposals) {
  const container = _ensureProposalsContainer();
  if (!container) return;
  const list = document.getElementById('upgradeProposalsList') || container;

  container.style.display = '';
  list.innerHTML = '';

  const valid = (proposals || []).filter(p => p && typeof p === 'object' && String(p.title || '').trim());

  if (!valid.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:11px;font-style:italic;">' +
      'AI tidak memberikan usulan task baru yang valid kali ini.</div>';
    return;
  }

  const nextWeek = _nextWeekNumber();

  const info = document.createElement('div');
  info.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px;';
  info.textContent = `Usulan akan ditambahkan ke Sprint Minggu ${nextWeek}.`;
  list.appendChild(info);

  const acceptAllBtn = document.createElement('button');
  acceptAllBtn.className = 'btn-primary';
  acceptAllBtn.style.cssText = 'margin-bottom:10px;';
  acceptAllBtn.textContent = '✅ Terima Semua';
  list.appendChild(acceptAllBtn);

  const rows = [];

  valid.forEach(p => {
    let priority = parseInt(p.priority, 10);
    if (!Number.isFinite(priority) || priority < 1 || priority > 4) priority = 3;

    const row = document.createElement('div');
    row.className = 'upgrade-proposal-item';
    row.style.cssText = 'border:1px solid var(--border-color, rgba(255,255,255,0.1));border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.03);';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start;';
    head.innerHTML =
      `<div style="font-weight:600;font-size:12px;">${_esc(p.title)}</div>` +
      `<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;">P${priority}</div>`;
    row.appendChild(head);

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:var(--text-secondary, var(--text-muted));margin:6px 0;line-height:1.5;';
    desc.textContent = String(p.description || '(tanpa deskripsi)');
    row.appendChild(desc);

    if (p.reason) {
      const reason = document.createElement('div');
      reason.style.cssText = 'font-size:10px;color:var(--text-muted);font-style:italic;margin-bottom:8px;';
      reason.textContent = `Alasan: ${String(p.reason)}`;
      row.appendChild(reason);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn-xs';
    acceptBtn.textContent = '✅ Terima';
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-xs';
    rejectBtn.textContent = '❌ Tolak';

    let settled = false;

    function markDone(label) {
      actions.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">${label}</span>`;
    }

    acceptBtn.addEventListener('click', () => {
      if (settled) return;
      settled = true;
      _acceptProposal(p, nextWeek);
      markDone('✅ Diterima');
      _toast('success', `Task "${String(p.title).slice(0, 40)}" ditambahkan ke Minggu ${nextWeek}.`);
    });
    rejectBtn.addEventListener('click', () => {
      if (settled) return;
      settled = true;
      markDone('❌ Ditolak');
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    row.appendChild(actions);

    list.appendChild(row);
    rows.push({
      accept: () => {
        if (settled) return false;
        settled = true;
        _acceptProposal(p, nextWeek);
        markDone('✅ Diterima');
        return true;
      }
    });
  });

  acceptAllBtn.addEventListener('click', () => {
    let count = 0;
    rows.forEach(r => {
      if (r.accept && r.accept()) count++;
    });
    _toast('success', `${count} task usulan ditambahkan ke Sprint Minggu ${nextWeek}.`);
  });
}

// ---------------------------------------------------------------------------
// Shared — meeting notes list
// ---------------------------------------------------------------------------

// Ensure the note viewer element exists (created dynamically).
function _ensureNoteViewer() {
  let viewer = document.getElementById('meetingNoteViewer');
  if (viewer) return viewer;

  const page = document.getElementById('page-meetings');
  if (!page) return null;

  viewer = document.createElement('div');
  viewer.id = 'meetingNoteViewer';
  viewer.style.cssText = 'margin-top:12px;display:none;';
  viewer.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span id="meetingNoteViewerTitle" style="font-size:12px;font-weight:600;"></span>' +
      '<button class="btn-xs" id="meetingNoteViewerClose">✕ Tutup</button>' +
    '</div>' +
    '<pre id="meetingNoteViewerContent" style="max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.6;background:rgba(0,0,0,0.25);border-radius:8px;padding:12px;margin:0;"></pre>';

  const inner = page.querySelector('.page-inner') || page;
  inner.appendChild(viewer);

  const closeBtn = viewer.querySelector('#meetingNoteViewerClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => { viewer.style.display = 'none'; });
  }
  return viewer;
}

// Load and display one note's content.
async function _viewMeetingNote(projectPath, file) {
  const viewer = _ensureNoteViewer();
  if (!viewer) return;
  const titleEl = viewer.querySelector('#meetingNoteViewerTitle');
  const contentEl = viewer.querySelector('#meetingNoteViewerContent');
  if (titleEl) titleEl.textContent = file.name || '';
  if (contentEl) contentEl.textContent = 'Memuat...';
  viewer.style.display = '';

  try {
    const data = await _postJson('/api/notes/read', {
      projectPath: projectPath,
      filePath: `meetings/${file.name}`
    });
    if (data && data.success) {
      if (contentEl) contentEl.textContent = data.content || '(kosong)';
    } else {
      if (contentEl) contentEl.textContent = (data && data.error) || 'Gagal membaca notulen.';
    }
  } catch (e) {
    if (contentEl) contentEl.textContent = `Tidak dapat membaca notulen: ${(e && e.message) || 'server tidak tersedia'}`;
  }
}

// Refresh the list of saved meeting notes (never throws).
async function refreshMeetingsList() {
  const container = document.getElementById('meetingsListContainer');
  if (!container) return;

  const projectPath = _getActiveProjectPath();
  if (!projectPath) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-style:italic;">Tidak ada proyek aktif. Pilih atau scan proyek terlebih dahulu.</div>';
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-style:italic;">Memuat daftar notulen...</div>';

  let files = [];
  try {
    const data = await _postJson('/api/notes/list', { projectPath, subdir: 'meetings' });
    if (data && data.success) {
      files = Array.isArray(data.files) ? data.files : [];
    } else {
      container.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-style:italic;">${_esc((data && data.error) || 'Gagal memuat daftar notulen.')}</div>`;
      return;
    }
  } catch (e) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-style:italic;">Server Node.js tidak tersedia. Jalankan server untuk menyimpan/melihat notulen.</div>';
    return;
  }

  if (!files.length) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:11px;font-style:italic;">Belum ada notulen. Jalankan rapat di atas.</div>';
    return;
  }

  container.innerHTML = '';
  files.forEach(file => {
    const row = document.createElement('div');
    row.className = 'meeting-note-item';
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--border-color, rgba(255,255,255,0.08));margin-bottom:6px;background:rgba(255,255,255,0.02);';

    const meta = document.createElement('div');
    meta.style.cssText = 'min-width:0;';
    meta.innerHTML =
      `<div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(file.name)}</div>` +
      `<div style="font-size:10px;color:var(--text-muted);">${_esc(_formatSize(file.size))} • ${_esc(_formatMtime(file.mtime))}</div>`;
    row.appendChild(meta);

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn-xs';
    viewBtn.textContent = '👁 Lihat';
    viewBtn.addEventListener('click', () => { _viewMeetingNote(projectPath, file); });
    row.appendChild(viewBtn);

    container.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function initMeetingsUpgradeUI() {
  try {
    _ensureProposalsContainer();
  } catch (e) { /* ignore */ }
}

function initMeetings() {
  initMeetingsUpgradeUI();
  refreshMeetingsList();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMeetings);
  } else {
    // DOM already parsed (script loaded late).
    initMeetings();
  }
}

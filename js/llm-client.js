/**
 * 2D Virtual Dev Office - LLM Client & Multi-Agent Sequential Pipeline
 * Supports OpenRouter, OmniRoute, OpenAI, and compatible endpoints, with fallback Demo Mode.
 */

class LLMClient {
  constructor() {
    this.apiBase = localStorage.getItem(OFFICE_CONFIG.storageKeys.API_BASE) || OFFICE_CONFIG.defaults.apiBase;
    this.apiKey = localStorage.getItem(OFFICE_CONFIG.storageKeys.API_KEY) || '';
    this.model = localStorage.getItem(OFFICE_CONFIG.storageKeys.MODEL) || OFFICE_CONFIG.defaults.model;
  }

  saveSettings(apiBase, apiKey, model) {
    this.apiBase = apiBase.trim().replace(/\/+$/, '');
    this.apiKey = apiKey.trim();
    this.model = model.trim();

    localStorage.setItem(OFFICE_CONFIG.storageKeys.API_BASE, this.apiBase);
    localStorage.setItem(OFFICE_CONFIG.storageKeys.API_KEY, this.apiKey);
    localStorage.setItem(OFFICE_CONFIG.storageKeys.MODEL, this.model);
  }

  // System Prompts for each role
  getSystemPrompt(agentId) {
    const agentSettings = this.getAgentSettings(agentId);
    const config = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents) ? OFFICE_CONFIG.agents[agentId] : null;
    const name = (agentSettings && agentSettings.name) ? agentSettings.name : (config ? config.name : agentId);

    // Dynamically-created characters can provide their own full system prompt.
    if (agentSettings && typeof agentSettings.customSystemPrompt === 'string' && agentSettings.customSystemPrompt.trim()) {
      const ctx = this.getIntegrationsContext(agentId);
      return ctx ? `${agentSettings.customSystemPrompt}\n\n${ctx}` : agentSettings.customSystemPrompt;
    }

    const prompts = {
      scrum_master: `Anda adalah ${name}, Agile Scrum Master & Orchestrator berpengalaman.
Tugas Anda:
1. Menganalisis deskripsi task dari user dan memecahnya menjadi User Stories terstruktur lengkap dengan Kriteria Penerimaan (Acceptance Criteria).
2. Tentukan batasan teknis (scope) dan instruksi spesifik untuk System Architect, Backend Dev, Frontend Dev, dan QA Engineer.
3. TENTUKAN ALUR KERJA (WORKFLOW) yang benar-benar dibutuhkan task ini. TIDAK semua task butuh 5 tahap — pilih HANYA tahap yang relevan (contoh: perbaikan CSS kecil boleh melewati backend_dev).
   Di BAGIAN PALING AKHIR jawaban Anda, WAJIB sertakan TEPAT SATU blok kode JSON berpagar dengan format berikut (tidak boleh ada teks apa pun setelah blok ini):
\`\`\`json
{"steps":[{"agent":"system_architect","dependsOn":["scrum_master"],"reason":"alasan singkat"},{"agent":"backend_dev","dependsOn":["system_architect"],"reason":"alasan singkat"},{"agent":"qa_engineer","dependsOn":["backend_dev"],"reason":"alasan singkat"}]}
\`\`\`
   Aturan blok JSON: nilai "agent" yang valid HANYA: scrum_master, system_architect, backend_dev, frontend_dev, qa_engineer. "scrum_master" wajib menjadi langkah pertama. Gunakan "dependsOn" (array nama agent) untuk menyatakan tahap prasyarat.
Gunakan Bahasa Indonesia yang profesional, jelas, dan terstruktur rapi dengan Markdown.`,

      system_architect: `Anda adalah ${name}, DB & System Architect senior.
Tugas Anda:
1. Merancang skema database relational MySQL (DDL lengkap: CREATE TABLE, Primary Key, Foreign Key, Indexing yang efisien, dan data type yang tepat).
2. Merancang kontrak REST API yang bersih (Endpoint path, HTTP Method, Request JSON Body, dan Response JSON Payload).
Pastikan query efisien, ternormalisasi (3NF), dan siap pakai.`,

      backend_dev: `Anda adalah ${name}, Senior Backend Developer spesialis PHP & CodeIgniter 4 (serta stack terkait).
Tugas Anda:
1. Menulis implementasi kode backend lengkap untuk Controller dan Model berdasarkan skema database & endpoint dari System Architect.
2. Pastikan kode bersih, modular, menggunakan parameterized queries / Query Builder untuk mencegah SQL Injection, validasi data server-side, dan penanganan error yang aman.
Tulis kode lengkap dan siap jalan tanpa placeholder yang terpotong.`,

      frontend_dev: `Anda adalah ${name}, Frontend & JavaScript Developer modern.
Tugas Anda:
1. Menulis kode tampilan antarmuka (HTML5 & CSS) yang modern, rapi, dan responsif untuk fitur tersebut.
2. Menulis kode JavaScript (ES6+ fetch API, async/await) untuk melakukan request AJAX ke endpoint backend, menangani state loading, validasi form, dan menampilkan data/feedback secara dinamis.
Tulis kode lengkap dan siap dijalankan.`,

      qa_engineer: `Anda adalah ${name}, QA & Security Engineer handal.
Tugas Anda:
1. Meninjau kode yang dihasilkan oleh Backend Dev dan Frontend Dev untuk mendeteksi potensi celah keamanan (OWASP Top 10: SQL Injection, XSS, CSRF, Authentication bypass, Unvalidated Redirect).
2. Menyusun daftar skenario pengujian (Test Cases) dan memberikan rekomendasi perbaikan.
3. Buat kesimpulan akhir (Final Deliverable Verdict) apakah fitur ini siap dideploy ke produksi.`,

      daisy: `Anda adalah ${name}, Front Desk Receptionist & Office Assistant ramah, sopan, dan hangat di Virtual Dev Office.
Tugas Anda:
1. Menyapa user dengan ramah, hangat, dan sopan.
2. Menjawab pertanyaan-pertanyaan user seputar proyek, konsep teknologi, penjelasan sistem, cara kerja tim kantor, atau pertanyaan umum lainnya.
3. PENTING: Anda TIDAK bertugas untuk menulis kode file proyek, mengubah file, atau mengeksekusi deliverable teknis sprint. Tugas Anda murni tanya-jawab interaktif dan memberikan panduan atau penjelasan yang jelas dan mudah dipahami.
Gunakan Bahasa Indonesia yang ramah, hangat, bersahabat, dan informatif.`
    };

    let basePrompt = prompts[agentId] || `Anda adalah ${name}, asisten pengembang software profesional.`;

    // Inject global + per-character MCP servers & Skills as context (tasks 16 & 17).
    const integrationCtx = this.getIntegrationsContext(agentId);
    if (integrationCtx) basePrompt += `\n\n${integrationCtx}`;

    return basePrompt;
  }

  // Compose the MCP & Skills context block for an agent (global + per-character).
  getIntegrationsContext(agentId) {
    const lines = [];
    try {
      const mcp = (typeof window !== 'undefined' && typeof window.getMcpForAgent === 'function')
        ? window.getMcpForAgent(agentId) : [];
      if (Array.isArray(mcp) && mcp.length > 0) {
        lines.push(`MCP SERVER YANG TERSEDIA UNTUK ANDA: ${mcp.join(', ')}.`);
      }

      const skills = (typeof window !== 'undefined' && typeof window.getSkillsForAgent === 'function')
        ? window.getSkillsForAgent(agentId) : [];
      if (Array.isArray(skills) && skills.length > 0) {
        lines.push(`SKILLS YANG DIKONFIGURASI UNTUK ANDA: ${skills.join(', ')}. Terapkan gaya & panduan skill ini bila relevan.`);
      }
    } catch (e) {}
    return lines.join('\n');
  }

  // Build sequential messages chain for each agent
  buildMessages(agentId, taskTitle, taskDesc, previousOutputs, taskFilesContext = '') {
    const messages = [
      { role: 'system', content: this.getSystemPrompt(agentId) }
    ];

    const smName = (this.getAgentSettings('scrum_master')?.name) || (typeof OFFICE_CONFIG !== 'undefined' ? OFFICE_CONFIG.agents.scrum_master.name : 'Scrum Master');
    const archName = (this.getAgentSettings('system_architect')?.name) || (typeof OFFICE_CONFIG !== 'undefined' ? OFFICE_CONFIG.agents.system_architect.name : 'System Architect');
    const beName = (this.getAgentSettings('backend_dev')?.name) || (typeof OFFICE_CONFIG !== 'undefined' ? OFFICE_CONFIG.agents.backend_dev.name : 'Backend Dev');
    const feName = (this.getAgentSettings('frontend_dev')?.name) || (typeof OFFICE_CONFIG !== 'undefined' ? OFFICE_CONFIG.agents.frontend_dev.name : 'Frontend Dev');

    let userPrompt = `TASK DARI SPRINT:\nJudul: ${taskTitle}\nDeskripsi: ${taskDesc}\n\n`;

    if (agentId === 'scrum_master') {
      userPrompt += `Analisis task ini dan buatkan sprint backlog teknis serta kriteria penerimaan yang jelas.`;
    } else if (agentId === 'system_architect') {
      userPrompt += `Berikut adalah analisis dari ${smName} (Scrum Master):\n\n${previousOutputs.scrum_master}\n\nBerdasarkan hal di atas, rancang skema MySQL DDL lengkap dan kontrak REST API.`;
    } else if (agentId === 'backend_dev') {
      userPrompt += `Berikut adalah rancangan database & API dari ${archName} (System Architect):\n\n${previousOutputs.system_architect}\n\nSilakan tulis kode backend PHP / CodeIgniter 4 lengkap (Controller & Model) yang aman.`;
    } else if (agentId === 'frontend_dev') {
      userPrompt += `Berikut adalah kontrak API dan detail fitur:\n\n${previousOutputs.system_architect}\n\nSilakan tulis kode UI HTML/CSS dan JavaScript AJAX fetch interaktif yang siap terhubung dengan backend.`;
    } else if (agentId === 'qa_engineer') {
      userPrompt += `Berikut adalah hasil pekerjaan tim:\n\n--- HASIL BACKEND (${beName}) ---\n${previousOutputs.backend_dev}\n\n--- HASIL FRONTEND (${feName}) ---\n${previousOutputs.frontend_dev}\n\nLakukan code review keamanan (SQLi, XSS, CSRF), tulis skenario uji, dan berikan Final Deliverable Verdict.`;
    }

    // Retry context: inform the agent about a previous failure on this very step
    if (previousOutputs && previousOutputs.__lastError) {
      userPrompt += `\n\n[CATATAN PERCOBAAN SEBELUMNYA]\nUpaya sebelumnya pada tahap ini GAGAL dengan error berikut:\n> ${previousOutputs.__lastError}\n\nSilakan perbaiki pendekatan Anda dan pastikan tidak mengulangi penyebab kegagalan tersebut sebelum melanjutkan.`;
    }

    if (taskFilesContext && taskFilesContext.trim()) {
      userPrompt += `\n\n${taskFilesContext}\n\n[PENTING] Perhatikan baik-baik kode file proyek yang ditargetkan di atas saat merancang dan menulis kode.`;
    }

    messages.push({ role: 'user', content: userPrompt });
    return messages;
  }

  // Read per-agent custom settings (name & model) from localStorage
  getAgentSettings(agentId) {
    try {
      const saved = localStorage.getItem('voffice_agent_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed[agentId] || null;
      }
    } catch (e) {}
    return null;
  }

  // Execute one step of the pipeline
  async executeAgentStep(agentId, taskTitle, taskDesc, previousOutputs, onProgress = null, taskFilesContext = '') {
    if (!this.apiKey) {
      throw new Error('API Key belum diisi. Silakan masukkan API Key pada tab Settings (⚙️).');
    }

    // Check if this specific agent has a designated custom AI model
    const agentSettings = this.getAgentSettings(agentId);
    const modelToUse = (agentSettings && agentSettings.model && agentSettings.model.trim()) 
      ? agentSettings.model.trim() 
      : this.model;

    if (onProgress) onProgress(`Mengirim prompt ke model ${modelToUse}...`);

    const messages = this.buildMessages(agentId, taskTitle, taskDesc, previousOutputs, taskFilesContext);

    const payload = {
      model: modelToUse,
      messages: messages,
      temperature: 0.3,
      max_tokens: 3000
    };

    return this._chat(payload, this.apiKey, 'Virtual Dev Office', 'Respon API kosong atau format tidak sesuai.');
  }

  // Low-level chat completion call (single network entry point for every feature)
  async _chat(endpointPayload, apiKey, title = 'Virtual Dev Office', emptyError = 'Respon API kosong atau format tidak sesuai.') {
    if (!apiKey) {
      throw new Error('API Key belum diisi. Silakan masukkan API Key pada tab Settings (⚙️).');
    }

    const endpoint = `${this.apiBase}/chat/completions`;
    const origin = (typeof window !== 'undefined' && window.location) ? (window.location.origin || 'http://localhost:3000') : 'http://localhost:3000';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': origin,
        'X-Title': title
      },
      body: JSON.stringify(endpointPayload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || response.statusText;
      throw new Error(`API Error (${response.status}): ${errorMsg}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error(emptyError);
    }

    return content;
  }

  // Public generic completion helper so other modules can reuse the client
  async complete({ systemPrompt = null, messages = [], model = null, temperature = 0.3, maxTokens = 3000, apiKey = null, title = 'Virtual Dev Office', emptyError = 'Respon API kosong atau format tidak sesuai.' } = {}) {
    const msgs = [];
    if (systemPrompt) {
      msgs.push({ role: 'system', content: systemPrompt });
    }
    (messages || []).forEach(m => msgs.push(m));

    const payload = {
      model: model || this.model,
      messages: msgs,
      temperature: temperature,
      max_tokens: maxTokens
    };

    return this._chat(payload, apiKey || this.apiKey, title, emptyError);
  }

  // --- STRUCTURED DELIVERABLES PARSER ---
  // Extract fenced code blocks that declare a target file path, either in the
  // info string (```js file:js/app.js) or as a first-line comment inside the
  // block (// file: js/app.js, # file: ..., <!-- file: ... -->, /* file: ... */).
  parseDeliverables(text) {
    const results = [];
    if (!text || typeof text !== 'string') return results;

    const fenceRe = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
    let match;
    while ((match = fenceRe.exec(text)) !== null) {
      const info = (match[1] || '').trim();
      const body = match[2] || '';
      let path = null;
      let lang = null;

      // 1) Path declared in the fenced info string
      const tokens = info.split(/\s+/).filter(Boolean);
      const otherTokens = [];
      for (const token of tokens) {
        const fileMatch = token.match(/^file:(.+)$/i);
        if (fileMatch) {
          path = fileMatch[1];
          continue;
        }
        otherTokens.push(token);
      }
      if (otherTokens.length && /^[\w.+#-]+$/.test(otherTokens[0])) {
        const token = otherTokens[0].toLowerCase();
        lang = this._guessLangFromPath('.' + token) || otherTokens[0];
      }

      // 2) Path declared as a first-line comment inside the block
      if (!path) {
        const firstLine = (body.split(/\r?\n/)[0] || '').trim();
        const commentMatch = firstLine.match(/(?:\/\/|#|\/\*|<!--)\s*file:\s*([^\s"'`]+)/i);
        if (commentMatch) {
          path = commentMatch[1];
        }
      }

      if (!path) continue; // Ignore blocks with no path marker

      path = this._cleanFilePath(path);
      if (!path) continue;
      if (!lang) lang = this._guessLangFromPath(path);

      results.push({ path: path, content: body, lang: lang || '' });
    }

    return results;
  }

  _cleanFilePath(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let p = raw.trim().replace(/^['"`<>]+|['"`<>]+$/g, '');
    p = p.replace(/[-*/>]+$/, ''); // strip trailing comment closers like */ or -->
    p = p.trim();
    return p || null;
  }

  _guessLangFromPath(path) {
    const ext = (String(path).split('.').pop() || '').toLowerCase();
    const map = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      php: 'php', html: 'html', htm: 'html', css: 'css', scss: 'scss',
      json: 'json', md: 'markdown', sql: 'sql', py: 'python',
      rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
      sh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', xml: 'xml', vue: 'vue', env: 'bash'
    };
    return map[ext] || '';
  }

  // --- SCRUM MASTER WORKFLOW PARSER ---
  // Tolerant parse of the LAST json block (or a {"steps": ...} object) describing
  // which agents must run for a task and in what dependency order.
  parseWorkflow(text) {
    const VALID = ['scrum_master', 'system_architect', 'backend_dev', 'frontend_dev', 'qa_engineer'];
    if (!text || typeof text !== 'string') return null;

    // Collect candidate strings: whole text first, then every fenced block in order.
    // The reverse scan below therefore prefers the LAST fenced block, then prose.
    const candidates = [text];
    const fenceRe = /```[^\n`]*\r?\n([\s\S]*?)```/g;
    let match;
    while ((match = fenceRe.exec(text)) !== null) {
      candidates.push(match[1]);
    }

    let rawSteps = null;
    for (let i = candidates.length - 1; i >= 0 && !rawSteps; i--) {
      rawSteps = this._extractWorkflowSteps(candidates[i]);
    }
    if (!rawSteps || !Array.isArray(rawSteps)) return null;

    const normalized = [];
    const seen = new Set();
    let scrumEntry = null;

    for (const raw of rawSteps) {
      if (!raw || typeof raw !== 'object') continue;
      const agent = String(raw.agent || '').trim();
      if (!VALID.includes(agent)) continue; // drop invalid agents
      if (seen.has(agent)) continue;        // drop duplicates
      seen.add(agent);

      const entry = {
        agent: agent,
        dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(d => String(d).trim()) : [],
        reason: (typeof raw.reason === 'string') ? raw.reason : ''
      };
      if (agent === 'scrum_master') {
        scrumEntry = entry;
        continue;
      }
      normalized.push(entry);
    }

    // If we found a steps array but nothing usable, treat it as unparseable so the
    // caller falls back to the full default chain instead of skipping everything.
    if (normalized.length === 0) return null;

    // Sanitize dependsOn against the final set of agents.
    const finalAgents = new Set(['scrum_master', ...normalized.map(e => e.agent)]);
    for (const entry of normalized) {
      entry.dependsOn = entry.dependsOn.filter(d => finalAgents.has(d) && d !== entry.agent);
    }

    if (!scrumEntry) {
      scrumEntry = { agent: 'scrum_master', dependsOn: [], reason: 'Orkestrasi, analisis task, dan penentuan workflow.' };
    }
    scrumEntry.dependsOn = [];

    return { steps: [scrumEntry, ...normalized] };
  }

  // Try to pull a `steps` array out of a JSON string (tolerant of surrounding prose).
  _extractWorkflowSteps(str) {
    if (!str || typeof str !== 'string') return null;

    const tryParse = (candidate) => {
      if (!candidate) return null;
      try {
        const parsed = JSON.parse(candidate.trim());
        if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
      } catch (e) {}
      return null;
    };

    let steps = tryParse(str);
    if (steps) return steps;

    const objectStr = this._extractJsonObjectContaining(str, '"steps"');
    if (objectStr) steps = tryParse(objectStr);
    return steps;
  }

  // Brace-matching extraction of the JSON object that contains a given needle.
  _extractJsonObjectContaining(str, needle) {
    // Prefer the LAST object containing the needle (the workflow block is at the end).
    const idx = str.lastIndexOf(needle);
    if (idx < 0) return null;

    const start = str.lastIndexOf('{', idx);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return str.slice(start, i + 1);
      }
    }
    return null;
  }

  // Ask Daisy (Front Desk pure Q&A assistant)
  async askDaisy(question, conversationHistory = []) {
    if (!this.apiKey) {
      throw new Error('API Key belum diisi. Silakan masukkan API Key pada tab Settings (⚙️).');
    }

    const agentSettings = this.getAgentSettings('daisy');
    const modelToUse = (agentSettings && agentSettings.model && agentSettings.model.trim())
      ? agentSettings.model.trim()
      : this.model;

    return this.complete({
      systemPrompt: this.getSystemPrompt('daisy'),
      messages: [
        ...conversationHistory,
        { role: 'user', content: question }
      ],
      model: modelToUse,
      temperature: 0.7,
      maxTokens: 1500,
      title: 'Virtual Dev Office - Daisy Reception',
      emptyError: 'Daisy tidak memberikan respon yang valid.'
    });
  }

  // Test API connectivity
  async testConnection(apiBase, apiKey, model) {
    const endpoint = `${apiBase.trim().replace(/\/+$/, '')}/chat/completions`;
    const payload = {
      model: model.trim(),
      messages: [{ role: 'user', content: 'Halo, berikan respon 1 kata "READY" jika kamu online.' }],
      max_tokens: 20
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'Koneksi Berhasil!';
  }
}

// Global LLM Client Instance
const llmClient = new LLMClient();

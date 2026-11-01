/**
 * 2D Pixel Art Virtual Dev Office & Sprint Manager - Configuration & Sound Engine
 */

const OFFICE_CONFIG = {
  canvas: {
    width: 1000,
    height: 860,
    scale: 1,
    fps: 60,
    // Cap the canvas bitmap DPR. 1 keeps pixel-art crisp while cutting fill-rate
    // roughly in half vs 2x (the biggest single render-cost win on HiDPI screens).
    maxDpr: 1,
    // Render pacing: full speed while the office is lively, throttled when quiet.
    fpsActive: 60,
    fpsIdle: 30
  },
  
  // Storage keys for localStorage persistence
  storageKeys: {
    API_BASE: 'voffice_api_base',
    API_KEY: 'voffice_api_key',
    MODEL: 'voffice_api_model',
    DEMO_MODE: 'voffice_demo_mode',
    SOUND_MUTED: 'voffice_sound_muted',
    BACKLOG: 'voffice_saved_backlog',
    CHAT_LOG: 'voffice_chat_log',
    PROJECTS: 'voffice_projects',
    ACTIVE_PROJECT: 'voffice_active_project'
  },

  // Default LLM Configuration
  defaults: {
    apiBase: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
    soundMuted: false
  },

  availableModels: [],

  // 5 Sub-Agents Profile & Visual Aesthetics
  agents: {
    scrum_master: {
      id: 'scrum_master',
      name: 'Citra',
      fullName: 'Citra (Scrum Master)',
      role: 'Scrum Master & Orchestrator',
      tag: 'scrum',
      color: '#f59e0b',
      accentBg: 'rgba(245, 158, 11, 0.2)',
      borderColor: '#f59e0b',
      badgeClass: 'scrum',
      emoji: '👑',
      hairColor: '#4a2c11',
      outfitColor: '#d97706',
      pantsColor: '#1e293b',
      skinColor: '#fcd34d',
      accessory: 'glasses',
      description: 'Menganalisis user story, requirements, dan memecah task menjadi sprint backlog teknis.',
      defaultRoom: 'pantry',
      targetStation: 'war_whiteboard'
    },
    system_architect: {
      id: 'system_architect',
      name: 'Bram',
      fullName: 'Bram (System Architect)',
      role: 'DB & System Architect',
      tag: 'architect',
      color: '#10b981',
      accentBg: 'rgba(16, 185, 129, 0.2)',
      borderColor: '#10b981',
      badgeClass: 'architect',
      emoji: '📐',
      hairColor: '#1e293b',
      outfitColor: '#059669',
      pantsColor: '#0f172a',
      skinColor: '#fde68a',
      accessory: 'blueprint',
      description: 'Merancang skema database relational MySQL (DDL/FK/Index) dan endpoint API contracts.',
      defaultRoom: 'pantry',
      targetStation: 'war_table_seat1'
    },
    backend_dev: {
      id: 'backend_dev',
      name: 'Reza',
      fullName: 'Reza (Senior Backend Dev)',
      role: 'Senior Backend Developer (PHP/CI4)',
      tag: 'backend',
      color: '#6366f1',
      accentBg: 'rgba(99, 102, 241, 0.2)',
      borderColor: '#6366f1',
      badgeClass: 'backend',
      emoji: '⚡',
      hairColor: '#334155',
      outfitColor: '#4f46e5',
      pantsColor: '#1e1b4b',
      skinColor: '#fde047',
      accessory: 'headphones',
      description: 'Menulis kode backend bersih, modular, controller, models, dan query database yang aman.',
      defaultRoom: 'pantry',
      targetStation: 'dev_backend_chair'
    },
    frontend_dev: {
      id: 'frontend_dev',
      name: 'Maya',
      fullName: 'Maya (Frontend Dev)',
      role: 'Frontend & UI/JS Developer',
      tag: 'frontend',
      color: '#06b6d4',
      accentBg: 'rgba(6, 182, 212, 0.2)',
      borderColor: '#06b6d4',
      badgeClass: 'frontend',
      emoji: '🎨',
      hairColor: '#831843',
      outfitColor: '#0891b2',
      pantsColor: '#334155',
      skinColor: '#fed7aa',
      accessory: 'stylish_hair',
      description: 'Menulis kode interface modern, HTML5/CSS3, dan integrasi interaktif JavaScript / AJAX.',
      defaultRoom: 'pantry',
      targetStation: 'dev_frontend_chair'
    },
    qa_engineer: {
      id: 'qa_engineer',
      name: 'Dimas',
      fullName: 'Dimas (QA Security)',
      role: 'QA & Security Engineer',
      tag: 'qa',
      color: '#f43f5e',
      accentBg: 'rgba(244, 63, 94, 0.2)',
      borderColor: '#f43f5e',
      badgeClass: 'qa',
      emoji: '🛡️',
      hairColor: '#18181b',
      outfitColor: '#e11d48',
      pantsColor: '#18181b',
      skinColor: '#fef08a',
      accessory: 'visor',
      description: 'Meninjau keamanan (SQLi, XSS, CSRF), test validation, dan memvalidasi Final Deliverable.',
      defaultRoom: 'pantry',
      targetStation: 'qa_server_desk'
    },
    daisy: {
      id: 'daisy',
      name: 'Daisy',
      fullName: 'Daisy (Front Desk)',
      role: 'Front Desk & Assistant',
      tag: 'reception',
      color: '#f472b6',
      accentBg: 'rgba(244, 114, 182, 0.2)',
      borderColor: '#f472b6',
      badgeClass: 'reception',
      emoji: '🛎️',
      hairColor: '#fde047',
      outfitColor: '#ec4899',
      pantsColor: '#1e293b',
      skinColor: '#fde68a',
      accessory: 'daisy_flower',
      description: 'Menyapa pengunjung dan menjawab pertanyaan biasa seputar kantor dan proyek (pure Q&A, no code editing).',
      defaultRoom: 'front_desk',
      targetStation: 'reception_chair'
    }
  },

  // Zone Definitions
  zones: {
    pantry: {
      id: 'pantry',
      name: 'Coffee Lounge & Pantry',
      label: '☕ Coffee Lounge / Pantry',
      description: 'Area santai agen saat IDLE dengan mesin espresso, sofa & coffee table.',
      bounds: { x1: 30, y1: 30, x2: 450, y2: 320 }
    },
    war_room: {
      id: 'war_room',
      name: 'Scrum & Meeting Room',
      label: '📊 Scrum & Meeting Room',
      description: 'Ruang kolaborasi Scrum Master & Architect menganalisis task di depan papan tulis.',
      bounds: { x1: 550, y1: 30, x2: 970, y2: 320 }
    },
    dev_cubicles: {
      id: 'dev_cubicles',
      name: 'Developer Cubicles',
      label: '💻 Developer Cubicles',
      description: 'Meja kerja Backend dan Frontend Dev dengan dual monitor & keyboard mengetik kode.',
      bounds: { x1: 30, y1: 380, x2: 450, y2: 670 }
    },
    qa_server: {
      id: 'qa_server',
      name: 'QA & Server Room',
      label: '🛡️ QA & Server Room',
      description: 'Ruang server dengan rack berkedip dan meja testing keamanan QA Engineer.',
      bounds: { x1: 550, y1: 380, x2: 970, y2: 670 }
    },
    front_desk: {
      id: 'front_desk',
      name: 'Front Desk & Reception',
      label: '🛎️ Front Desk & Reception',
      description: 'Meja resepsionis dengan Daisy, siap menyapa dan menjawab pertanyaan seputar proyek dan kantor.',
      bounds: { x1: 30, y1: 676, x2: 970, y2: 840 }
    }
  },

  // Weighted standby / idle behaviors for agents hanging out in the Coffee Lounge.
  // Each entry: state to play, waypoint to occupy, chatter lines, a random duration
  // range (frames) and a relative weight used by the weighted random picker.
  idleBehaviors: [
    {
      state: 'DRINKING',
      wp: 'pantry_water',
      lines: [
        '☕ Seduh espresso dulu ya...',
        '💧 Minum air mineral biar segar',
        '☕ Refill kafein untuk fokus sprint!',
        '💧 Hidrasi dulu sebelum ngoding'
      ],
      minDur: 180,
      maxDur: 380,
      weight: 26
    },
    {
      state: 'EATING',
      wp: 'pantry_table',
      lines: [
        '🥪 Ngemil sebentar, otak butuh glukosa',
        '🍩 Donat sisa meeting, sayang kalau dibuang',
        '🥐 Roti bakar pagi ini enak juga',
        '🍪 Biskuit sambil review pull request'
      ],
      minDur: 200,
      maxDur: 400,
      weight: 24
    },
    {
      state: 'SITTING',
      wp: 'pantry_sofa_left',
      lines: [
        '🪑 Duduk santai di sofa',
        '🛋️ Rehat lima menit di lounge',
        '🪑 Sofa ini tempat diskusi paling nyaman'
      ],
      minDur: 220,
      maxDur: 420,
      weight: 20
    },
    {
      state: 'SITTING',
      wp: 'pantry_sofa_right',
      lines: [
        '🛋️ Duduk dekat jendela, adem',
        '🪑 Nunggu build selesai sambil duduk'
      ],
      minDur: 220,
      maxDur: 420,
      weight: 12
    },
    {
      state: 'SLEEPING',
      wp: 'pantry_sofa_left',
      lines: [
        '😴 Zzz... lima menit aja',
        '😪 Tidur sebentar, ngantuk berat',
        '💤 Istirahatkan mata sejenak'
      ],
      minDur: 240,
      maxDur: 460,
      weight: 8
    },
    {
      state: 'IDLE',
      wp: 'pantry_center',
      lines: [
        'Suasana kantor hari ini produktif!',
        'Semoga sprint kali ini zero bug 🚀',
        'Menunggu instruksi Scrum Master...',
        'Semangat tim dev virtual! 🔥'
      ],
      minDur: 150,
      maxDur: 300,
      weight: 18
    },
    {
      state: 'IDLE',
      wp: 'pantry_coffee_machine',
      lines: [
        '☕ Aroma Robusta harum sekali!',
        '☕ Ngobrol santai dekat mesin kopi',
        'Semoga tidak ada bug kritis minggu ini'
      ],
      minDur: 150,
      maxDur: 300,
      weight: 14
    }
  ]
};

/**
 * Procedural 8-bit Sound Effects Engine (Web Audio API)
 * Zero external MP3 files needed.
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(OFFICE_CONFIG.storageKeys.SOUND_MUTED) === 'true';
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(OFFICE_CONFIG.storageKeys.SOUND_MUTED, muted.toString());
  }

  isMuted() {
    return this.muted;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.1) {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  // Blip on UI click
  playClick() {
    this.playTone(600, 'triangle', 0.05, 0.08);
  }

  // Light footstep tick
  playStep() {
    this.playTone(180, 'sine', 0.04, 0.03);
  }

  // Keyboard typing click
  playKeyboard() {
    const freqs = [850, 920, 1050, 780, 1150];
    const randFreq = freqs[Math.floor(Math.random() * freqs.length)];
    this.playTone(randFreq, 'square', 0.03, 0.02);
  }

  // Coffee pouring hiss & bubble
  playCoffee() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      this.playTone(450, 'sawtooth', 0.2, 0.05);
      setTimeout(() => this.playTone(550, 'sine', 0.15, 0.06), 150);
      setTimeout(() => this.playTone(700, 'triangle', 0.25, 0.05), 300);
    } catch (e) {}
  }

  // Meeting start bell chime
  playBell() {
    if (this.muted) return;
    this.playTone(587.33, 'sine', 0.4, 0.12); // D5
    setTimeout(() => this.playTone(880, 'sine', 0.6, 0.1), 180); // A5
  }

  // Sprint / Task completed victory chime
  playComplete() {
    if (this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        this.playTone(freq, 'triangle', 0.25, 0.12);
      }, idx * 120);
    });
  }

  // Warning / Bug found alert
  playAlert() {
    if (this.muted) return;
    this.playTone(280, 'sawtooth', 0.15, 0.1);
    setTimeout(() => this.playTone(220, 'sawtooth', 0.2, 0.1), 120);
  }
}

// Global Sound Instance
const soundFx = new SoundEngine();

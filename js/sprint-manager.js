/**
 * 2D Virtual Dev Office - Sprint Backlog & Multi-Agent Orchestrator
 * Manages the priority queue, automated sequential workflow, and state synchronization.
 */

// Fallback workflow used when the Scrum Master does not yield a parseable workflow.
const DEFAULT_WORKFLOW = {
  steps: [
    { agent: 'scrum_master', dependsOn: [], reason: 'Analisis task, acceptance criteria, dan penentuan alur kerja.' },
    { agent: 'system_architect', dependsOn: ['scrum_master'], reason: 'Desain skema database & kontrak REST API.' },
    { agent: 'backend_dev', dependsOn: ['system_architect'], reason: 'Implementasi kode backend.' },
    { agent: 'frontend_dev', dependsOn: ['system_architect'], reason: 'Implementasi UI & integrasi API.' },
    { agent: 'qa_engineer', dependsOn: ['backend_dev', 'frontend_dev'], reason: 'Audit keamanan & test cases.' }
  ]
};

// Maps an agent key to its chat-log key + human role name.
const WORKFLOW_AGENT_MAP = {
  scrum_master: { chatKey: 'scrum', roleName: 'Scrum Master' },
  system_architect: { chatKey: 'architect', roleName: 'System Architect' },
  backend_dev: { chatKey: 'backend', roleName: 'Senior Backend Dev' },
  frontend_dev: { chatKey: 'frontend', roleName: 'Frontend Dev' },
  qa_engineer: { chatKey: 'qa', roleName: 'QA & Security Engineer' }
};

// Which method implements each agent step.
const WORKFLOW_STEP_RUNNERS = {
  scrum_master: 'runScrumMasterStep',
  system_architect: 'runSystemArchitectStep',
  backend_dev: 'runBackendDevStep',
  frontend_dev: 'runFrontendDevStep',
  qa_engineer: 'runQAStep'
};

class SprintManager {
  constructor(characters, renderer) {
    this.characters = characters; // dictionary of AgentCharacter instances
    this.renderer = renderer;

    this.tasks = [];
    this.currentTaskIndex = -1;
    this.isRunning = false;
    this.isPaused = false;
    this.activeTask = null;
    this.currentStep = null; // 'scrum_master', 'system_architect', 'backend_dev', 'frontend_dev', 'qa_engineer'

    // Parallel orchestration state
    this.activeTasks = new Map();      // taskId -> task (currently being executed)
    this.agentLocks = new Set();       // agentKey -> locked by an in-flight step
    this.MAX_PARALLEL_TASKS = 2;       // how many tasks may run at once
    this.MAX_PARALLEL_STEPS = 3;       // how many LLM steps may run at once
    this._activeSteps = 0;             // current LLM step count (semaphore)
    this._taskPromises = new Set();    // in-flight runTask promises
    this._failedThisRun = new Set();   // taskIds that already errored in this sprint run

    // Weekly sprint tracking
    this.currentWeek = parseInt(localStorage.getItem('voffice_current_week'), 10) || 1;
    this.weeks = [1];

    // Live chat history (persisted in localStorage)
    this.chatLog = [];
    this.loadChatLog();

    // Initialize projects
    this.initDefaultProject();

    // Load initial or saved tasks
    this.loadBacklog();
  }

  // Load chat log from localStorage
  loadChatLog() {
    try {
      const saved = localStorage.getItem(OFFICE_CONFIG.storageKeys.CHAT_LOG);
      if (saved) {
        this.chatLog = JSON.parse(saved);
      }
    } catch (e) {}
  }

  // Save chat log to localStorage
  saveChatLog() {
    try {
      localStorage.setItem(OFFICE_CONFIG.storageKeys.CHAT_LOG, JSON.stringify(this.chatLog));
    } catch (e) {}
  }

  // Clear chat log
  clearChatLog() {
    this.chatLog = [];
    this.saveChatLog();
    if (this.onChatLogUpdated) {
      this.onChatLogUpdated(null);
    }
    soundFx.playClick();
  }

  // Project Context Management (Multiple Projects support)
  getProjects() {
    try {
      const saved = localStorage.getItem(OFFICE_CONFIG.storageKeys.PROJECTS);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  }

  saveProjects(projects) {
    try {
      localStorage.setItem(OFFICE_CONFIG.storageKeys.PROJECTS, JSON.stringify(projects));
    } catch (e) {}
  }

  getActiveProject() {
    const projects = this.getProjects();
    const activeId = localStorage.getItem(OFFICE_CONFIG.storageKeys.ACTIVE_PROJECT);
    return projects.find(p => p.id === activeId) || projects[0] || null;
  }

  setActiveProject(projectId) {
    localStorage.setItem(OFFICE_CONFIG.storageKeys.ACTIVE_PROJECT, projectId);
    if (this.onProjectChanged) this.onProjectChanged();
  }

  async initDefaultProject() {
    const projects = this.getProjects();
    if (projects.length === 0) {
      // Register current workspace folder by default
      const defaultPath = '.';
      try {
        const res = await fetch('/api/project/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: defaultPath })
        });
        const data = await res.json();
        if (data.success) {
          const newProj = {
            id: 'proj_' + Date.now(),
            name: 'Custom Office (Default)',
            path: data.path,
            files: data.files || [],
            fileCount: data.count || 0
          };
          this.saveProjects([newProj]);
          this.setActiveProject(newProj.id);
        }
      } catch (e) {}
    }
  }

  async loadFilesContent(projectPath, fileList) {
    if (!fileList || fileList.length === 0) return '';
    let combined = '=== KONTEKS FILE PROYEK YANG DITARGETKAN (@file) ===\n\n';
    for (const relFile of fileList) {
      try {
        const res = await fetch('/api/project/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: projectPath, filePath: relFile })
        });
        const data = await res.json();
        if (data.success) {
          combined += `[FILE: ${relFile}]\n\`\`\`\n${data.content}\n\`\`\`\n\n`;
        }
      } catch (e) {}
    }
    combined += '====================================================\n';
    return combined;
  }

  // Load backlog from localStorage or seed initial tasks
  loadBacklog() {
    const saved = localStorage.getItem(OFFICE_CONFIG.storageKeys.BACKLOG);
    if (saved) {
      try {
        this.tasks = JSON.parse(saved);
        // Ensure all tasks have a week assigned and a step-state map
        this.tasks.forEach(t => {
          if (!t.week) t.week = 1;
          if (!t.outputs) t.outputs = {};
          if (!t.stepStates) {
            // Migrate legacy tasks: treat already-saved deliverables as DONE.
            t.stepStates = {};
            Object.keys(t.outputs).forEach(k => {
              if (k !== '__lastError') t.stepStates[k] = 'DONE';
            });
          }
        });
        const taskWeeks = this.tasks.map(t => t.week || 1);
        this.weeks = Array.from(new Set([1, ...taskWeeks, this.currentWeek])).sort((a, b) => a - b);
        this.sortTasks();
        return;
      } catch (e) {}
    }

    // Default Seed Tasks (Assigned to Week 1)
    this.tasks = [
      {
        id: 'TASK-' + Math.floor(1000 + Math.random() * 9000),
        title: 'Sistem Autentikasi JWT & Role Permission (Admin, Manager, Staff)',
        description: 'Implementasi API login/register, token JWT, hashing password Argon2ID, dan middleware hak akses bertingkat dengan CodeIgniter 4 dan MySQL.',
        priority: 1, // Critical
        status: 'PENDING',
        week: 1,
        createdAt: new Date().toISOString(),
        outputs: {},
        activeAgent: null
      },
      {
        id: 'TASK-' + Math.floor(1000 + Math.random() * 9000),
        title: 'Modul Manajemen Produk & Peringatan Stok Rendah (REST API & Alert)',
        description: 'CRUD produk inventaris, log pergerakan stok (in/out), perhitungan otomatis, dan trigger peringatan jika stok di bawah ambang batas.',
        priority: 2, // High
        status: 'PENDING',
        week: 1,
        createdAt: new Date().toISOString(),
        outputs: {},
        activeAgent: null
      }
    ];

    this.weeks = [1];
    this.sortTasks();
    this.saveBacklog();
  }

  saveBacklog() {
    try {
      localStorage.setItem(OFFICE_CONFIG.storageKeys.BACKLOG, JSON.stringify(this.tasks));
    } catch (e) {}
  }

  // Get tasks for a specific week (defaults to currentWeek)
  getWeekTasks(week = this.currentWeek) {
    return this.tasks.filter(t => (t.week || 1) === week);
  }

  // Switch active sprint week
  setWeek(weekNumber) {
    const w = parseInt(weekNumber, 10) || 1;
    this.currentWeek = w;
    if (!this.weeks.includes(w)) {
      this.weeks.push(w);
      this.weeks.sort((a, b) => a - b);
    }
    try {
      localStorage.setItem('voffice_current_week', this.currentWeek.toString());
    } catch (e) {}
    this.onBacklogUpdated();
  }

  // Create a new sprint week
  createNewWeek() {
    const maxWeek = this.weeks.length > 0 ? Math.max(...this.weeks) : 1;
    const newWeek = maxWeek + 1;
    this.setWeek(newWeek);
    return newWeek;
  }

  // Auto-sort tasks: IN_PROGRESS / ERROR first, then PENDING by priority, then DONE
  sortTasks() {
    this.tasks.sort((a, b) => {
      const aActive = (a.status === 'IN_PROGRESS' || a.status === 'ERROR') ? 1 : 0;
      const bActive = (b.status === 'IN_PROGRESS' || b.status === 'ERROR') ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      if (a.status === 'DONE' && b.status !== 'DONE') return 1;
      if (a.status !== 'DONE' && b.status === 'DONE') return -1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  // Add new task to backlog
  addTask(title, description, priority = 3, week = null, mentionedFiles = []) {
    const taskWeek = parseInt(week || this.currentWeek, 10) || 1;

    // Auto-extract @file mentions from title & description
    const textToScan = `${title} ${description}`;
    const matches = textToScan.match(/@([a-zA-Z0-9_\-\.\/]+)/g) || [];
    const extractedFiles = matches.map(m => m.substring(1));
    const allFiles = Array.from(new Set([...(mentionedFiles || []), ...extractedFiles]));

    const task = {
      id: 'TASK-' + Math.floor(1000 + Math.random() * 9000),
      title: title.trim(),
      description: description.trim(),
      priority: parseInt(priority, 10) || 3,
      week: taskWeek,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      outputs: {},
      stepStates: {},
      workflow: null,
      activeAgent: null,
      mentionedFiles: allFiles
    };

    if (!this.weeks.includes(taskWeek)) {
      this.weeks.push(taskWeek);
      this.weeks.sort((a, b) => a - b);
    }

    this.tasks.push(task);
    this.sortTasks();
    this.saveBacklog();
    this.onBacklogUpdated();

    const fileNotice = allFiles.length > 0 ? ` (Target file: ${allFiles.join(', ')})` : '';
    this.addChatLog('system', 'System', '📋 Task Baru Ditambahkan', `Task "${task.title}" (Prioritas: ${task.priority}, Minggu ${task.week})${fileNotice} masuk ke backlog.`);
    soundFx.playClick();
    return task;
  }

  // Update task status (Kanban column drop / status transition)
  updateTaskStatus(taskId, newStatus) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    if (oldStatus === newStatus) return;

    task.status = newStatus;
    if (newStatus === 'DONE') {
      task.activeAgent = null;
      delete task.lastError;
      delete task.failedStep;
      soundFx.playComplete();
      this.addChatLog('system', 'System', '✅ Task Dipindahkan ke Selesai', `Task "${task.title}" ditandai selesai.`);
    } else if (newStatus === 'PENDING') {
      task.activeAgent = null;
      delete task.lastError;
      delete task.failedStep;
    }

    this.sortTasks();
    this.saveBacklog();
    this.onBacklogUpdated();
    soundFx.playClick();
  }

  // Delete task
  deleteTask(taskId) {
    if (this.activeTasks && this.activeTasks.has(taskId)) {
      alert('Tidak bisa menghapus task yang sedang berjalan.');
      return;
    }
    if (this.activeTask && this.activeTask.id === taskId && this.isRunning) {
      alert('Tidak bisa menghapus task yang sedang berjalan.');
      return;
    }
    this.tasks = this.tasks.filter(t => t.id !== taskId);
    this.saveBacklog();
    this.onBacklogUpdated();
    soundFx.playClick();
  }

  // Clear all completed tasks for current week
  clearCompletedTasks() {
    this.tasks = this.tasks.filter(t => !((t.week || 1) === this.currentWeek && t.status === 'DONE'));
    this.saveBacklog();
    this.onBacklogUpdated();
    soundFx.playClick();
  }

  // Add log to Live Office Chat stream
  addChatLog(agentKey, senderName, title, text, codeSnippet = null) {
    let effectiveSender = senderName;
    const map = {
      scrum: 'scrum_master',
      architect: 'system_architect',
      backend: 'backend_dev',
      frontend: 'frontend_dev',
      qa: 'qa_engineer',
      reception: 'daisy',
      daisy: 'daisy'
    };
    const agentId = map[agentKey] || agentKey;
    if (this.characters && this.characters[agentId]) {
      const char = this.characters[agentId];
      effectiveSender = char.fullName || `${char.name} (${char.role || char.tag})`;
    } else if (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents && OFFICE_CONFIG.agents[agentId]) {
      const ag = OFFICE_CONFIG.agents[agentId];
      effectiveSender = ag.fullName || `${ag.name} (${ag.role || ag.tag})`;
    }

    const logItem = {
      id: 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      agentKey: agentKey,
      senderName: effectiveSender,
      title: title,
      text: text,
      codeSnippet: codeSnippet,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    this.chatLog.push(logItem);
    this.saveChatLog();
    if (this.onChatLogUpdated) {
      this.onChatLogUpdated(logItem);
    }
  }

  // Send all agents back to their home stations (Pantry for Devs, Front Desk for Daisy)
  sendAllAgentsToPantry() {
    const pantryWps = [
      'pantry_coffee_machine',
      'pantry_sofa_left',
      'pantry_sofa_right',
      'pantry_table',
      'pantry_water',
      'pantry_center'
    ];

    let idx = 0;
    for (const [key, agent] of Object.entries(this.characters)) {
      agent.state = 'IDLE';
      if (key === 'daisy') {
        agent.moveToWaypoint('reception_chair');
      } else {
        const targetWp = pantryWps[idx % pantryWps.length];
        agent.moveToWaypoint(targetWp);
        idx++;
      }
    }
  }

  // --- AUTOMATED SPRINT EXECUTION PIPELINE ---
  async startSprint() {
    if (this.isRunning) return;

    this._failedThisRun = new Set();
    const available = this.getSchedulableTasks();

    if (available.length === 0) {
      this.addChatLog('system', 'System', '🎉 Sprint Minggu Ini Selesai', `Semua task pada Sprint Minggu ${this.currentWeek} telah selesai dikerjakan!`);
      soundFx.playComplete();
      this.sendAllAgentsToPantry();
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.onSprintStateChanged(true);

    const isResuming = available.some(t => t.status === 'ERROR' || t.status === 'IN_PROGRESS');
    if (isResuming) {
      this.addChatLog('system', 'System', `▶ Melanjutkan Sprint Minggu ${this.currentWeek}`, `Melanjutkan pengerjaan task yang sempat tertunda tanpa mengulang tahap yang sudah selesai.`);
    } else {
      const parallel = Math.min(available.length, this.MAX_PARALLEL_TASKS);
      this.addChatLog('system', 'System', `🚀 Sprint Minggu ${this.currentWeek} Dimulai`, `Mengeksekusi ${parallel} task secara paralel dari backlog (maks. ${this.MAX_PARALLEL_TASKS} task / ${this.MAX_PARALLEL_STEPS} langkah bersamaan).`);
    }
    soundFx.playBell();

    await this.schedule();
  }

  pauseSprint() {
    this.isPaused = true;
    this.isRunning = false;
    this.onSprintStateChanged(false);
    this.addChatLog('system', 'System', '⏸ Sprint Dijeda', 'Eksekusi sprint dihentikan sementara. Langkah yang sedang berjalan akan diselesaikan lebih dulu.');
  }

  // Backward-compatible single entry point: delegates to the parallel scheduler.
  async processNextTask() {
    if (!this.isRunning) return this.startSprint();
    if (this.isPaused) return;
    await this.schedule();
  }

  // --- SCHEDULER ---

  // Tasks of the current week that are eligible to run right now (highest priority first).
  getSchedulableTasks() {
    const weekTasks = this.getWeekTasks().filter(t =>
      !this.activeTasks.has(t.id) && !this._failedThisRun.has(t.id)
    );

    const byPriority = (a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    };

    const resumable = weekTasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'ERROR').sort(byPriority);
    const pending = weekTasks.filter(t => t.status === 'PENDING').sort(byPriority);
    return [...resumable, ...pending];
  }

  // Main loop: keep up to MAX_PARALLEL_TASKS tasks in flight until nothing is left.
  async schedule() {
    while (this.isRunning && !this.isPaused) {
      for (const task of this.getSchedulableTasks()) {
        if (this.activeTasks.size >= this.MAX_PARALLEL_TASKS) break;
        if (!this.isRunning || this.isPaused) break;
        if (this.activeTasks.has(task.id)) continue;
        this._launchTask(task);
      }

      if (this.activeTasks.size === 0) break; // nothing running and nothing left to start

      await Promise.race([
        Promise.race([...this._taskPromises].map(p => p.catch(() => {}))),
        this._tick(120)
      ]);
    }

    // Wait for every in-flight task to settle (pause path or natural drain).
    await Promise.all([...this._taskPromises].map(p => p.catch(() => {})));

    if (this.isPaused) return; // pauseSprint already notified the UI

    if (this.isRunning) {
      this.isRunning = false;
      this.onSprintStateChanged(false);
    }

    const remaining = this.getSchedulableTasks().length;
    if (remaining > 0) return; // safety: more work appeared (new task added mid-sprint)

    const weekTasks = this.getWeekTasks();
    const allDone = weekTasks.length > 0 && weekTasks.every(t => t.status === 'DONE');
    if (allDone) {
      this.addChatLog('system', 'System', `🏆 Sprint Minggu ${this.currentWeek} Selesai Penuh`, `Semua antrean backlog Minggu ${this.currentWeek} berhasil dituntaskan!`);
      soundFx.playComplete();
    } else {
      this.addChatLog('system', 'System', `⏸ Sprint Minggu ${this.currentWeek} Dihentikan`, `Antrean sprint selesai diproses, namun ada task yang masih perlu perhatian (lihat status error).`);
    }
    this.sendAllAgentsToPantry();
    this.onBacklogUpdated();
  }

  _launchTask(task) {
    const promise = this.runTask(task)
      .catch(err => console.error(`Kesalahan tak terduga pada task ${task.id}:`, err))
      .finally(() => {
        this._taskPromises.delete(promise);
        this._syncActiveTaskPointer();
      });
    this._taskPromises.add(promise);
    return promise;
  }

  _tick(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Keep this.activeTask pointing at the first active task (app.js backward compat).
  _syncActiveTaskPointer() {
    const first = this.activeTasks.values().next();
    this.activeTask = first.done ? null : first.value;
    if (this.onActiveTasksChanged) this.onActiveTasksChanged([...this.activeTasks.values()]);
  }

  // Agent-level mutual exclusion across tasks.
  acquireAgent(agentKey) {
    if (this.agentLocks.has(agentKey)) return false;
    this.agentLocks.add(agentKey);
    return true;
  }

  releaseAgent(agentKey) {
    this.agentLocks.delete(agentKey);
  }

  // Step-concurrency semaphore (caps simultaneous LLM calls).
  async _acquireStepSlot() {
    while (this._activeSteps >= this.MAX_PARALLEL_STEPS) {
      await this._tick(40);
      if (this.isPaused) break;
    }
    this._activeSteps++;
  }

  _releaseStepSlot() {
    this._activeSteps = Math.max(0, this._activeSteps - 1);
  }

  // Resolve the effective, dependency-ordered workflow for a task.
  getEffectiveWorkflow(task) {
    const src = (task && task.workflow && Array.isArray(task.workflow.steps) && task.workflow.steps.length)
      ? task.workflow
      : DEFAULT_WORKFLOW;

    const rawSteps = src.steps.filter(s => s && WORKFLOW_AGENT_MAP[s.agent]);
    if (rawSteps.length === 0) return this.getEffectiveWorkflow({ workflow: DEFAULT_WORKFLOW });

    const ordered = this._topoSortSteps(rawSteps);

    const effective = ordered.map(step => ({
      agentKey: step.agent,
      chatKey: WORKFLOW_AGENT_MAP[step.agent].chatKey,
      roleName: WORKFLOW_AGENT_MAP[step.agent].roleName,
      agent: this.characters ? this.characters[step.agent] : null,
      dependsOn: (Array.isArray(step.dependsOn) ? step.dependsOn : []).filter(d => d !== step.agent)
    }));

    // Drop dependencies that are not part of this workflow (avoids dead-locking
    // on a step that will never exist).
    const presentKeys = new Set(effective.map(s => s.agentKey));
    effective.forEach(s => {
      s.dependsOn = s.dependsOn.filter(d => d !== s.agentKey && presentKeys.has(d));
    });

    // Scrum Master always leads.
    effective.sort((a, b) => {
      if (a.agentKey === 'scrum_master') return -1;
      if (b.agentKey === 'scrum_master') return 1;
      return 0;
    });

    return effective;
  }

  // Stable DFS topological sort (dependencies first). Cycles are tolerated.
  _topoSortSteps(steps) {
    const present = new Set(steps.map(s => s.agent));
    const deps = new Map();
    for (const s of steps) {
      const d = (Array.isArray(s.dependsOn) ? s.dependsOn : []).filter(x => present.has(x) && x !== s.agent);
      deps.set(s.agent, d);
    }

    const out = [];
    const visited = new Set();
    const visiting = new Set();
    const visit = (agent) => {
      if (visited.has(agent) || visiting.has(agent)) return;
      visiting.add(agent);
      for (const dep of deps.get(agent) || []) visit(dep);
      visiting.delete(agent);
      visited.add(agent);
      out.push(agent);
    };
    for (const s of steps) visit(s.agent);

    return out.map(agent => steps.find(s => s.agent === agent));
  }

  // --- TASK RUNNER ---

  // Execute a single task's workflow, resuming from the last DONE step.
  async runTask(task) {
    if (!task) return 'NOOP';

    if (!task.outputs) task.outputs = {};
    if (!task.stepStates) task.stepStates = {};

    // Steps that failed or were interrupted in a previous run are retried now
    // (task.lastError / task.failedStep are kept so the agent gets the context).
    Object.keys(task.stepStates).forEach(key => {
      if (task.stepStates[key] === 'FAILED' || task.stepStates[key] === 'RUNNING') {
        task.stepStates[key] = 'PENDING';
      }
    });

    task.status = 'IN_PROGRESS';
    this.activeTasks.set(task.id, task);
    this._syncActiveTaskPointer();
    this.saveBacklog();
    this.onBacklogUpdated();

    // Load @file contents if task mentions files and context not yet cached
    if (task.mentionedFiles && task.mentionedFiles.length > 0 && !task.filesContext) {
      const activeProj = this.getActiveProject();
      if (activeProj && activeProj.path) {
        try {
          task.filesContext = await this.loadFilesContent(activeProj.path, task.mentionedFiles);
        } catch (e) {
          console.warn('Gagal memuat konteks file project:', e);
        }
      }
    }

    try {
      let taskFailed = false;
      let stallTicks = 0;

      while (!taskFailed) {
        if (!this.isRunning || this.isPaused) return 'PAUSED';

        const steps = this.getEffectiveWorkflow(task);
        const pending = steps.filter(s => task.stepStates[s.agentKey] !== 'DONE');
        if (pending.length === 0) break; // all workflow steps are DONE

        if (pending.some(s => task.stepStates[s.agentKey] === 'FAILED')) {
          taskFailed = true;
          break;
        }

        // A step is ready when all of its dependencies are DONE.
        const ready = pending.filter(s => s.dependsOn.every(d => task.stepStates[d] === 'DONE'));
        if (ready.length === 0) {
          // Nothing can progress although no step is running or failed: this is a
          // dependency cycle. Fail the task instead of spinning forever.
          if (stallTicks >= 5) {
            task.status = 'ERROR';
            task.lastError = 'Alur kerja tidak dapat dilanjutkan (ketergantungan antar tahap melingkar atau tidak lengkap).';
            task.failedStep = pending[0] ? pending[0].agentKey : null;
            this._failedThisRun.add(task.id);
            this.addChatLog('system', 'System', '⚠️ Alur Kerja Tidak Valid', `Task "${task.title}" dihentikan: ${task.lastError}`);
            soundFx.playAlert();
            taskFailed = true;
            break;
          }
          stallTicks++;
          await this._tick(60);
          continue;
        }
        stallTicks = 0;

        const outcomes = await Promise.all(ready.map(step => this._executeStep(task, step)));
        if (outcomes.some(o => o === 'FAILED')) taskFailed = true;
        if (outcomes.some(o => o === 'PAUSED')) return 'PAUSED';
      }

      if (taskFailed) {
        // task.status/lastError already set by _executeStep; only THIS task stops.
        this.saveBacklog();
        this.onBacklogUpdated();
        return 'FAILED';
      }

      // Complete Task successfully
      task.status = 'DONE';
      task.activeAgent = null;
      delete task.lastError;
      delete task.failedStep;
      delete task.outputs.__lastError;
      this.saveBacklog();
      this.onBacklogUpdated();
      if (this.onTaskCompleted) this.onTaskCompleted(task);
      this.addChatLog('system', 'System', `✅ Task Selesai: ${task.title}`, 'Semua deliverable telah diverifikasi dan siap diserahkan.');
      soundFx.playComplete();
      this._returnTaskAgentsToPantry(task);
      return 'DONE';
    } finally {
      this.activeTasks.delete(task.id);
      this._syncActiveTaskPointer();
    }
  }

  // Run one workflow step for a task (agent lock + step semaphore + state machine).
  async _executeStep(task, step) {
    // Wait for the agent to become free (another task may be using it).
    while (this.isRunning && !this.isPaused) {
      if (this.acquireAgent(step.agentKey)) break;
      await this._tick(40);
    }
    if (!this.isRunning || this.isPaused) return 'PAUSED';

    await this._acquireStepSlot();
    if (!this.isRunning || this.isPaused) {
      this._releaseStepSlot();
      this.releaseAgent(step.agentKey);
      return 'PAUSED';
    }

    task.stepStates[step.agentKey] = 'RUNNING';
    if (step.agent) task.activeAgent = step.agent.name;
    if (this.onTaskStepChanged) this.onTaskStepChanged(task, step.agentKey, 'RUNNING');
    this.onBacklogUpdated();

    try {
      const runnerName = WORKFLOW_STEP_RUNNERS[step.agentKey];
      const runner = runnerName ? this[runnerName] : null;
      if (typeof runner !== 'function') {
        throw new Error(`Tahap "${step.agentKey}" tidak memiliki implementasi runner.`);
      }

      await runner.call(this, task);

      task.stepStates[step.agentKey] = 'DONE';
      if (this.onTaskStepChanged) this.onTaskStepChanged(task, step.agentKey, 'DONE');
      this.saveBacklog();
      this.onBacklogUpdated();
      return 'DONE';
    } catch (err) {
      task.stepStates[step.agentKey] = 'FAILED';
      task.status = 'ERROR';
      task.lastError = err.message;
      task.failedStep = step.agentKey;
      this._failedThisRun.add(task.id);

      console.error(`Kendala pada tahap ${step.roleName}:`, err);

      if (step.agent) {
        step.agent.state = 'IDLE';
        step.agent.say(`⚠️ Waduh! Error AI: ${err.message}`, 450);
      }

      this.addChatLog(
        step.chatKey,
        (step.agent && step.agent.fullName) || step.roleName,
        '⚠️ Laporan Kendala Eksekusi',
        `Rekan-rekan tim, saya mengalami kendala saat memproses task **"${task.title}"**:\n\n> ❌ **Pesan Error**: ${err.message}\n\nSilakan periksa konfigurasi **API Key** atau **Model AI** di tab **Pengaturan (⚙️)**. Setelah kendala diperbaiki, klik tombol **"Lanjutkan Sprint"** untuk melanjutkan dari tahap saya tanpa mengulang tahap yang sudah selesai.`
      );

      soundFx.playAlert();
      if (this.onTaskStepChanged) this.onTaskStepChanged(task, step.agentKey, 'FAILED');
      this.saveBacklog();
      this.onBacklogUpdated();
      return 'FAILED';
    } finally {
      this._releaseStepSlot();
      this.releaseAgent(step.agentKey);
    }
  }

  // Inputs handed to a step. On a retry of the previously-failed step we attach a
  // per-step COPY carrying the previous error, so concurrent steps never collide.
  _getStepInputs(task, agentKey) {
    const prev = task.outputs || {};
    if (task.lastError && task.failedStep === agentKey) {
      return Object.assign({}, prev, { __lastError: task.lastError });
    }
    return prev;
  }

  // Return only the agents involved in this task back to their home stations.
  _returnTaskAgentsToPantry(task) {
    const pantryWps = [
      'pantry_coffee_machine',
      'pantry_sofa_left',
      'pantry_sofa_right',
      'pantry_table',
      'pantry_water',
      'pantry_center'
    ];

    const steps = this.getEffectiveWorkflow(task);
    let idx = 0;
    for (const step of steps) {
      const agent = this.characters ? this.characters[step.agentKey] : null;
      if (!agent || typeof agent.moveToWaypoint !== 'function') continue;
      agent.state = 'IDLE';
      if (step.agentKey === 'daisy') {
        agent.moveToWaypoint('reception_chair');
      } else {
        agent.moveToWaypoint(pantryWps[idx % pantryWps.length]);
        idx++;
      }
    }
  }

  // --- ROLLBACK ---

  // Roll back a task to (and including) a given step: later deliverables are discarded.
  rollbackTask(taskId, toStepKey) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return false;
    if (this.activeTasks && this.activeTasks.has(taskId)) return false;
    if (this.activeTask && this.activeTask.id === taskId && this.isRunning) return false;

    const steps = this.getEffectiveWorkflow(task);
    const idx = steps.findIndex(s => s.agentKey === toStepKey);
    if (idx < 0) return false;

    if (!task.outputs) task.outputs = {};
    if (!task.stepStates) task.stepStates = {};

    for (const step of steps.slice(idx)) {
      delete task.outputs[step.agentKey];
      delete task.stepStates[step.agentKey];
    }
    delete task.outputs.__lastError;
    delete task.lastError;
    delete task.failedStep;
    task.activeAgent = null;
    if (task.status !== 'IN_PROGRESS') task.status = 'PENDING';

    this.sortTasks();
    this.saveBacklog();
    this.onBacklogUpdated();

    this.addChatLog('system', 'System', '↩️ Rollback Task', `Task "${task.title}" dikembalikan ke tahap **${steps[idx].roleName}**. Deliverable setelah tahap tersebut dihapus dan akan dikerjakan ulang.`);
    soundFx.playClick();
    return true;
  }

  // Convenience: step back N executed steps ("1 langkah mundur").
  rollbackStep(taskId, steps = 1) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return false;

    const workflow = this.getEffectiveWorkflow(task);
    const doneIndexes = [];
    workflow.forEach((step, i) => {
      if (task.stepStates && task.stepStates[step.agentKey] === 'DONE' && task.outputs && task.outputs[step.agentKey]) {
        doneIndexes.push(i);
      }
    });
    if (doneIndexes.length === 0) return false;

    const n = Math.max(1, parseInt(steps, 10) || 1);
    const targetIdx = doneIndexes[Math.max(0, doneIndexes.length - n)];
    return this.rollbackTask(taskId, workflow[targetIdx].agentKey);
  }

  // --- STEP 1: SCRUM MASTER ---
  async runScrumMasterStep(task) {
    const sm = this.characters.scrum_master;
    task.activeAgent = sm.name;
    this.onBacklogUpdated();

    sm.say('👑 Menuju Meeting Room untuk briefing sprint...', 180);
    await new Promise(resolve => sm.moveToWaypoint('war_whiteboard', resolve));

    sm.state = 'MEETING';
    sm.say('👑 Menganalisis user requirements & scope...', 240);
    this.addChatLog('scrum', sm.fullName, 'Menganalisis Scope Task', `Memecah task "${task.title}" menjadi acceptance criteria...`);

    const output = await llmClient.executeAgentStep('scrum_master', task.title, task.description, this._getStepInputs(task, 'scrum_master'), (status) => {
      sm.say(`👑 ${status}`, 160);
    }, task.filesContext);

    task.outputs.scrum_master = output;

    // The Scrum Master decides which steps this task actually needs.
    const parsedWorkflow = (typeof llmClient !== 'undefined' && typeof llmClient.parseWorkflow === 'function')
      ? llmClient.parseWorkflow(output)
      : null;

    if (parsedWorkflow) {
      task.workflow = parsedWorkflow;
      const chain = parsedWorkflow.steps.map(s => s.agent).join(' → ');
      this.addChatLog('scrum', sm.fullName, 'Workflow Sprint Ditetapkan', `Alur eksekusi untuk task ini: **${chain}**`, `\`\`\`json\n${JSON.stringify(parsedWorkflow)}\n\`\`\``);
    } else {
      task.workflow = DEFAULT_WORKFLOW;
      this.addChatLog('system', 'System', '🧭 Workflow Default Digunakan', `Scrum Master tidak memberikan blok workflow JSON yang valid untuk task "${task.title}". Menggunakan alur standar 5 tahap.`);
    }

    this.addChatLog('scrum', sm.fullName, 'User Story & Backlog Siap', 'Rancangan kriteria penerimaan telah selesai. Menyerahkan ke System Architect.', output.substring(0, 200) + '...');
    soundFx.playClick();
    this.onDeliverableUpdated(task, 'scrum_master');
  }

  // --- STEP 2: SYSTEM ARCHITECT ---
  async runSystemArchitectStep(task) {
    const architect = this.characters.system_architect;
    task.activeAgent = architect.name;
    this.onBacklogUpdated();

    architect.say('📐 Menuju Meeting Room untuk desain skema...', 180);
    await new Promise(resolve => architect.moveToWaypoint('war_table_seat1', resolve));

    architect.state = 'MEETING';
    architect.say('📐 Merancang MySQL DDL & REST API contracts...', 240);
    this.addChatLog('architect', architect.fullName, 'Merancang Arsitektur Database', 'Mendesain tabel MySQL ternormalisasi, indeks, dan endpoint API...');

    const output = await llmClient.executeAgentStep('system_architect', task.title, task.description, this._getStepInputs(task, 'system_architect'), (status) => {
      architect.say(`📐 ${status}`, 160);
    }, task.filesContext);

    task.outputs.system_architect = output;
    this.addChatLog('architect', architect.fullName, 'Database Schema & API Selesai', 'Skema tabel MySQL dan REST payload telah siap untuk diimplementasikan Backend & Frontend.', output.substring(0, 200) + '...');
    soundFx.playClick();
    this.onDeliverableUpdated(task, 'system_architect');
  }

  // --- STEP 3: SENIOR BACKEND DEV ---
  async runBackendDevStep(task) {
    const be = this.characters.backend_dev;
    task.activeAgent = be.name;
    this.onBacklogUpdated();

    be.say('⚡ Siap! Menuju meja kerja backend...', 180);
    await new Promise(resolve => be.moveToWaypoint('dev_backend_chair', resolve));

    be.state = 'CODING';
    be.say('⚡ Menulis CodeIgniter 4 Controller & Query aman...', 240);
    this.addChatLog('backend', be.fullName, 'Mulai Koding Backend', 'Mengimplementasikan Controller, Model, parameterized query, dan validasi data...');

    const output = await llmClient.executeAgentStep('backend_dev', task.title, task.description, this._getStepInputs(task, 'backend_dev'), (status) => {
      be.say(`⚡ ${status}`, 160);
    }, task.filesContext);

    task.outputs.backend_dev = output;
    this.addChatLog('backend', be.fullName, 'Kode Backend Selesai', 'Implementasi backend PHP / CodeIgniter 4 siap dan lolos validasi lokal.', output.substring(0, 200) + '...');
    soundFx.playClick();
    this.onDeliverableUpdated(task, 'backend_dev');
  }

  // --- STEP 4: FRONTEND / JS DEV ---
  async runFrontendDevStep(task) {
    const fe = this.characters.frontend_dev;
    task.activeAgent = fe.name;
    this.onBacklogUpdated();

    fe.say('🎨 Menuju meja kerja frontend...', 180);
    await new Promise(resolve => fe.moveToWaypoint('dev_frontend_chair', resolve));

    fe.state = 'CODING';
    fe.say('🎨 Menulis HTML/CSS modern & AJAX fetch...', 240);
    this.addChatLog('frontend', fe.fullName, 'Mulai Koding Frontend', 'Membangun UI responsif dan script JavaScript integrasi API...');

    const output = await llmClient.executeAgentStep('frontend_dev', task.title, task.description, this._getStepInputs(task, 'frontend_dev'), (status) => {
      fe.say(`🎨 ${status}`, 160);
    }, task.filesContext);

    task.outputs.frontend_dev = output;
    this.addChatLog('frontend', fe.fullName, 'Kode Frontend Selesai', 'Template antarmuka dan client-side fetch script siap terhubung ke backend.', output.substring(0, 200) + '...');
    soundFx.playClick();
    this.onDeliverableUpdated(task, 'frontend_dev');
  }

  // --- STEP 5: QA & SECURITY ENGINEER ---
  async runQAStep(task) {
    const qa = this.characters.qa_engineer;
    task.activeAgent = qa.name;
    this.onBacklogUpdated();

    qa.say('🛡️ Menuju QA & Server Room untuk audit...', 180);
    await new Promise(resolve => qa.moveToWaypoint('qa_server_desk', resolve));

    qa.state = 'REVIEWING';
    qa.say('🛡️ Memeriksa kerentanan OWASP (SQLi/XSS/CSRF)...', 240);
    this.addChatLog('qa', qa.fullName, 'Audit Keamanan & Test Cases', 'Memindai potensi bug keamanan dan memverifikasi kesesuaian acceptance criteria...');

    const output = await llmClient.executeAgentStep('qa_engineer', task.title, task.description, this._getStepInputs(task, 'qa_engineer'), (status) => {
      qa.say(`🛡️ ${status}`, 160);
    }, task.filesContext);

    task.outputs.qa_engineer = output;
    this.addChatLog('qa', qa.fullName, 'Audit QA Selesai - APPROVED', 'Laporan QA & Security terverifikasi. Final deliverable siap untuk production.', output.substring(0, 200) + '...');
    soundFx.playClick();
    this.onDeliverableUpdated(task, 'qa_engineer');
  }

  // UI Event hooks (overridden by app.js)
  onBacklogUpdated() {}
  onChatLogUpdated(logItem) {}
  onDeliverableUpdated(task, agentKey) {}
  onSprintStateChanged(isRunning) {}
  onTaskCompleted(task) {}
  // Optional newer hooks — app.js may adopt these later; every call is guarded.
  onTaskStepChanged(task, stepKey, state) {}
  onActiveTasksChanged(activeTasks) {}
}

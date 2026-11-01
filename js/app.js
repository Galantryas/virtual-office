/**
 * 2D Virtual Dev Office & Sprint Manager - Application Controller
 * Handles UI interactions, animation loop, canvas mouse events, and state synchronization.
 */

// Global State References
let canvas, ctx, renderer, sprintManager;
const characters = {};
let selectedDeliverableAgent = 'scrum_master';
let officeMinutes = 9 * 60; // Start at 09:00 AM

// Initialize on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  initCanvasAndCharacters();
  initSprintManager();
  initUIEventListeners();
  initSettingsValues();
  initProjectSelector();
  initFileAutocomplete();
  renderBacklogUI();
  renderChatLogUI();

  // Full-screen page router & optional feature modules
  initPageRouter();
  if (typeof initCharacterPage === 'function') initCharacterPage();
  if (typeof initIntegrations === 'function') initIntegrations();
  if (typeof refreshMeetingsList === 'function') refreshMeetingsList();

  // Warn if the Node file API is not available
  checkServerApi();

  // Start Main Animation Loop
  requestAnimationFrame(gameLoop);
});

function loadSavedAgentSettings() {
  try {
    const saved = localStorage.getItem('voffice_agent_settings');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
}

/**
 * 1. Initialize Canvas, Renderer, & Sub-Agents (including Daisy at Front Desk)
 */
function initCanvasAndCharacters() {
  canvas = document.getElementById('officeCanvas');
  renderer = new OfficeRenderer(canvas);
  renderer.resize();
  window.addEventListener('resize', requestRendererResize);
  window.addEventListener('orientationchange', requestRendererResize);

  const savedSettings = loadSavedAgentSettings();

  // Initialize the characters starting in Coffee Lounge / Pantry (Daisy in Front Desk)
  const agentConfigs = OFFICE_CONFIG.agents;
  const initialSpots = [
    'pantry_coffee_machine',
    'pantry_sofa_left',
    'pantry_sofa_right',
    'pantry_table',
    'pantry_water'
  ];

  let idx = 0;
  for (const [key, config] of Object.entries(agentConfigs)) {
    const startWp = (key === 'daisy') ? 'reception_chair' : initialSpots[idx % initialSpots.length];
    const custom = savedSettings ? savedSettings[key] : null;
    const effectiveConfig = { ...config };
    if (custom && custom.name) {
      effectiveConfig.name = custom.name;
      if (custom.fullName && !custom.fullName.includes(config.name)) {
        effectiveConfig.fullName = custom.fullName;
      } else {
        effectiveConfig.fullName = `${custom.name} (${config.role || config.tag})`;
      }
    }

    // Keep global config in sync
    OFFICE_CONFIG.agents[key].name = effectiveConfig.name;
    OFFICE_CONFIG.agents[key].fullName = effectiveConfig.fullName;

    characters[key] = new AgentCharacter(effectiveConfig, startWp);
    if (key !== 'daisy') idx++;

    // Sync HUD label
    const hudEl = document.getElementById(`hud_name_${key}`);
    if (hudEl) {
      hudEl.textContent = effectiveConfig.name;
      const roleEl = document.getElementById(`hud_role_${key}`);
      if (roleEl) {
        roleEl.textContent = effectiveConfig.tag === 'reception' ? 'Front Desk' : (effectiveConfig.tag || '');
      }
    }
  }

  // Initial welcome thoughts
  if (characters.scrum_master) characters.scrum_master.say('Selamat pagi tim! Siap memulai sprint?', 260);
  if (characters.backend_dev) characters.backend_dev.say('☕ Ngopi dulu sebelum deploy...', 240);
  if (characters.daisy) characters.daisy.say('Selamat datang di Front Desk! Ada yang bisa saya bantu? 🛎️', 260);
}

/**
 * 2. Initialize Sprint Manager & Event Hooks
 */
function initSprintManager() {
  sprintManager = new SprintManager(characters, renderer);

  // Hook: Backlog data changed
  sprintManager.onBacklogUpdated = () => {
    renderBacklogUI();
    updateDeliverablesDropdown();
  };

  // Hook: Chat Log added
  sprintManager.onChatLogUpdated = (logItem) => {
    appendChatLogItem(logItem);
    const chatBadge = document.getElementById('chatCountBadge');
    if (chatBadge) {
      chatBadge.textContent = sprintManager.chatLog.length;
    }
  };

  // Hook: Deliverable finished by an agent
  sprintManager.onDeliverableUpdated = (task, agentKey) => {
    updateDeliverablesDropdown();
    if (task.id === getSelectedDeliverableTaskId()) {
      showDeliverableContent(agentKey);
    }

    const codeBadge = document.getElementById('codeCountBadge');
    if (codeBadge) {
      let count = 0;
      sprintManager.tasks.forEach(t => {
        count += Object.keys(t.outputs || {}).length;
      });
      if (count > 0) {
        codeBadge.textContent = count;
        codeBadge.style.display = 'inline-block';
      }
    }

    showToast('info', `Deliverable baru dari ${OFFICE_CONFIG.agents[agentKey].name}!`);
  };

  // Hook: Sprint start/pause state
  sprintManager.onSprintStateChanged = (isRunning) => {
    const dot = document.getElementById('sprintStatusDot');
    const text = document.getElementById('sprintStatusText');
    const btnStart = document.getElementById('btnStartSprint');
    const btnPause = document.getElementById('btnPauseSprint');

    if (isRunning) {
      dot.className = 'status-dot active';
      const n = (sprintManager.activeTasks && sprintManager.activeTasks.size) || 1;
      text.textContent = n > 1 ? `Sprint Running (${n} task paralel)` : 'Sprint Running';
      btnStart.style.display = 'none';
      btnPause.style.display = 'flex';
    } else {
      dot.className = 'status-dot';
      const hasInterrupted = sprintManager.tasks.some(
        t => (t.week || 1) === sprintManager.currentWeek && (t.status === 'ERROR' || t.status === 'IN_PROGRESS')
      );
      if (hasInterrupted) {
        text.textContent = 'Sprint Terhenti (Ada Kendala)';
        btnStart.innerHTML = '<span>▶</span> Lanjutkan Sprint';
      } else {
        text.textContent = 'Sprint Idle';
        btnStart.innerHTML = '<span>▶</span> Mulai Eksekusi Sprint';
      }
      btnStart.style.display = 'flex';
      btnPause.style.display = 'none';
    }
  };

  // Hook: Task completed
  sprintManager.onTaskCompleted = (task) => {
    showToast('success', `✓ Task "${task.title}" Selesai!`);
  };

  // Hook: parallel scheduler progress (multiple active tasks / step transitions)
  sprintManager.onActiveTasksChanged = () => {
    if (!sprintManager.isRunning) return;
    const text = document.getElementById('sprintStatusText');
    const n = (sprintManager.activeTasks && sprintManager.activeTasks.size) || 0;
    if (text) text.textContent = n > 1 ? `Sprint Running (${n} task paralel)` : 'Sprint Running';
  };

  sprintManager.onTaskStepChanged = () => {
    renderBacklogUI();
  };
}

/**
 * 3. Main Simulation Loop (adaptive pacing + render skipping when off-screen)
 * The world simulation always advances (so movement callbacks & sprint steps
 * keep resolving), but the expensive draw only runs while the Office page is
 * visible. When the office is quiet the draw is throttled to save CPU.
 */
let lastClockAdvance = 0;
let lastRenderTime = 0;
const statusPillEls = {};
const STANDBY_STATES = { EATING: 1, DRINKING: 1, SITTING: 1, SLEEPING: 1 };
let resizeTimer = null;

// Debounced resize: the resize/fullscreen events fire in bursts.
function requestRendererResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (renderer && typeof renderer.resize === 'function') renderer.resize();
  }, 120);
}

function isOfficePageVisible() {
  if (document.hidden) return false;
  const page = document.getElementById('page-office');
  return !!(page && page.classList.contains('active'));
}

// Something worth animating? (moving, talking, working, dust/particles, sprint)
function officeHasActivity() {
  if (typeof sprintManager !== 'undefined' && sprintManager && sprintManager.isRunning) return true;
  if (renderer && renderer.particles && renderer.particles.length > 0) return true;
  for (const agent of Object.values(characters)) {
    if (agent.isMoving) return true;
    if (agent.speech && agent.speech.timer > 0) return true;
    if (agent.state && agent.state !== 'IDLE' && !STANDBY_STATES[agent.state]) return true;
  }
  return false;
}

function updateAgentStatusPill(agent) {
  let el = statusPillEls[agent.id];
  if (!el || !el.isConnected) {
    el = document.getElementById(`status_${agent.id}`);
    statusPillEls[agent.id] = el;
  }
  if (!el) return;
  if (el.textContent !== agent.state) el.textContent = agent.state;
  if (el.dataset.state !== agent.state) el.dataset.state = agent.state;
  // Standby poses (eat/drink/sit/sleep) are "idle-ish", not a work state.
  const active = agent.state !== 'IDLE' && !STANDBY_STATES[agent.state];
  if (el.classList.contains('active') !== active) el.classList.toggle('active', active);
}

function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  const ts = (typeof now === 'number') ? now : performance.now();

  // Office clock (time-based so it is unaffected by frame pacing)
  if (ts - lastClockAdvance >= 3000) {
    lastClockAdvance = ts;
    officeMinutes++;
    const hours = Math.floor(officeMinutes / 60) % 24;
    const mins = officeMinutes % 60;
    const day = Math.floor(officeMinutes / (24 * 60)) + 1;
    const clockStr = `Day ${day} • ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const clockEl = document.getElementById('officeClockDisplay');
    if (clockEl) clockEl.textContent = clockStr;
  }

  // 1. Advance the simulation (cheap) so pathfinding callbacks still resolve.
  for (const agent of Object.values(characters)) {
    agent.update(renderer);
    updateAgentStatusPill(agent);
  }

  // 2. Draw only while the Office page is visible.
  if (!isOfficePageVisible()) {
    // Keep particle lifecycles bounded while off-screen (no drawing).
    if (renderer && typeof renderer.updateParticles === 'function') renderer.updateParticles();
    return;
  }

  // 3. Adaptive pacing: full speed when lively, throttled when quiet.
  const targetFps = officeHasActivity()
    ? (OFFICE_CONFIG.canvas.fpsActive || 60)
    : (OFFICE_CONFIG.canvas.fpsIdle || 30);
  if (ts - lastRenderTime < (1000 / targetFps)) return;
  lastRenderTime = ts;

  // 4. Render 2.5D Isometric World with Unified Strict Y-Sorting (Props + Characters)
  renderer.render(characters);
}

/**
 * 4. UI Tab Switching & Event Listeners
 */
function initUIEventListeners() {
  // Main Tab Buttons (Backlog / Chat / Settings)
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');

      soundFx.playClick();
    });
  });

  // Sprint Controls
  document.getElementById('btnStartSprint').addEventListener('click', () => {
    sprintManager.startSprint();
  });

  document.getElementById('btnPauseSprint').addEventListener('click', () => {
    sprintManager.pauseSprint();
  });

  // Coffee Break Button
  document.getElementById('btnCoffeeBreak').addEventListener('click', () => {
    sprintManager.sendAllAgentsToPantry();
    soundFx.playCoffee();
    showToast('info', '☕ Semua agen menuju Coffee Lounge untuk istirahat!');
  });

  // Sound Toggle Button
  const btnSound = document.getElementById('btnSoundToggle');
  const soundIcon = document.getElementById('soundIcon');
  btnSound.addEventListener('click', () => {
    const isMuted = soundFx.toggleMute();
    soundIcon.textContent = isMuted ? '🔇' : '🔊';
    showToast('info', isMuted ? 'Suara dinonaktifkan' : 'Suara diaktifkan');
  });
  if (soundFx.isMuted()) {
    soundIcon.textContent = '🔇';
  }

  // Reset Positions Button
  document.getElementById('btnResetPositions').addEventListener('click', () => {
    sprintManager.sendAllAgentsToPantry();
    showToast('info', 'Posisi semua agen diatur ulang ke Pantry.');
  });

  // Hook Camera State Changes -> Sync UI Highlights
  renderer.onCameraChanged = (camInfo) => {
    // Update Room Zone Tags Highlight
    document.querySelectorAll('.zone-tag').forEach(zt => {
      if (camInfo.mode === 'room' && zt.getAttribute('data-room') === camInfo.room) {
        zt.classList.add('active');
      } else {
        zt.classList.remove('active');
      }
    });

    // Update Agent HUD Pills Highlight
    document.querySelectorAll('.agent-pill').forEach(ap => {
      if (camInfo.mode === 'follow' && camInfo.agent && ap.getAttribute('data-agent') === camInfo.agent.id) {
        ap.classList.add('following');
      } else {
        ap.classList.remove('following');
      }
    });
  };

  // Room Zone Tags Click -> Zoom to Room
  document.querySelectorAll('.zone-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const roomKey = tag.getAttribute('data-room');
      toggleRoomZoom(roomKey);
    });
  });

  // Agent Quick Bar Pill Clicks -> Focus & Follow Agent
  document.querySelectorAll('.agent-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const agentId = pill.getAttribute('data-agent');
      const agent = characters[agentId];
      if (agent) {
        soundFx.playClick();
        if (renderer.camera.followingAgent === agent) {
          renderer.resetCamera();
        } else {
          renderer.followAgent(agent);
          const quips = [
            `Halo! Saya ${agent.name}, status saat ini: ${agent.state}`,
            `Sedang memantau sprint backlog 🚀`,
            `Fokus menjaga performa dan arsitektur kode!`
          ];
          agent.say(quips[Math.floor(Math.random() * quips.length)], 200);
        }
      }
    });
  });

  // Canvas Mouse Interactions (Hover Tooltip & Clicks)
  initCanvasInteractions();

  // Deliverables Sub-Tab Buttons
  document.querySelectorAll('.d-tab-btn').forEach(dBtn => {
    dBtn.addEventListener('click', () => {
      document.querySelectorAll('.d-tab-btn').forEach(b => b.classList.remove('active'));
      dBtn.classList.add('active');
      selectedDeliverableAgent = dBtn.getAttribute('data-dtab');
      soundFx.playClick();
      updateDeliverableContentDisplay();
    });
  });

  // Deliverable Task Select Dropdown
  const taskSelect = document.getElementById('deliverableTaskSelect');
  taskSelect.addEventListener('change', () => {
    updateDeliverableContentDisplay();
  });

  // Chat Filter Chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.getAttribute('data-filter');
      soundFx.playClick();
      filterChatStream(filter);
    });
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (sprintManager.isRunning) {
        sprintManager.pauseSprint();
      } else {
        sprintManager.startSprint();
      }
    } else if (e.code === 'KeyM') {
      btnSound.click();
    } else if (e.code === 'Escape') {
      if (renderer && renderer.isZoomed()) {
        soundFx.playClick();
        renderer.resetCamera();
      }
    }
  });
}

/**
 * 4b. Page Router (Full-Screen Pages) & Fullscreen Mode
 * The whole sidebar-tab + modal UI has been replaced by routed full-screen pages.
 */
const OFFICE_PAGES = [
  'page-office', 'page-kanban', 'page-chat', 'page-code',
  'page-meetings', 'page-characters', 'page-daisy', 'page-projects', 'page-settings'
];

function showPage(pageId, skipHash = false) {
  if (!OFFICE_PAGES.includes(pageId)) pageId = 'page-office';

  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === pageId);
  });
  document.querySelectorAll('.page-nav-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-page') === pageId);
  });

  if (!skipHash) {
    try { history.replaceState(null, '', '#' + pageId.replace('page-', '')); } catch (e) {}
  }

  // The canvas renderer needs to re-measure after its page becomes visible again.
  if (pageId === 'page-office') requestRendererResize();
}

function initPageRouter() {
  const hash = (location.hash || '').replace('#', '');
  if (hash) {
    const target = 'page-' + hash;
    if (OFFICE_PAGES.includes(target)) showPage(target, true);
  }

  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#', '');
    const target = 'page-' + h;
    if (OFFICE_PAGES.includes(target)) showPage(target, true);
  });

  const onFsChange = () => {
    syncFullscreenUI();
    requestRendererResize();
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('MSFullscreenChange', onFsChange);
}

// Keep the fullscreen buttons' labels in sync with the actual state.
function syncFullscreenUI() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  const navBtn = document.getElementById('btnFullscreenNav');
  if (navBtn) navBtn.innerHTML = isFs ? '<span>✕</span> Keluar Fullscreen' : '<span>⛶</span> Fullscreen';
  const canvasBtn = document.getElementById('btnFullscreenCanvas');
  if (canvasBtn) canvasBtn.innerHTML = isFs ? '✕ Keluar Fullscreen' : '⛶ Fullscreen';
}

function toggleCanvasFullscreen() {
  const el = document.getElementById('canvasContainer') || document.documentElement;
  soundFx.playClick();

  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);

  if (!isFs) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      const p = req.call(el);
      if (p && typeof p.catch === 'function') {
        p.catch(() => showToast('error', 'Browser menolak mode layar penuh.'));
      }
    } else {
      showToast('error', 'Mode layar penuh tidak didukung browser ini.');
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) {
      const p = exit.call(document);
      if (p && typeof p.catch === 'function') {
        p.catch(() => showToast('error', 'Gagal keluar dari layar penuh.'));
      }
    }
    // Safety net: keep the UI in sync even if the exit event is delayed.
    setTimeout(syncFullscreenUI, 250);
  }
}

/**
 * 5. Canvas Mouse Click & Hover Detection (With Camera Screen-to-World Translation)
 */
function toggleRoomZoom(roomKey) {
  soundFx.playClick();
  if (renderer.camera.activeRoom === roomKey) {
    renderer.resetCamera();
  } else {
    renderer.zoomToRoom(roomKey);
  }
}

function initCanvasInteractions() {
  const hoverInfo = document.getElementById('canvasHoverInfo');

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Convert screen coordinates to world coordinates according to current camera transform
    const world = renderer.screenToWorld(mouseX, mouseY);
    const worldX = world.x;
    const worldY = world.y;

    let hovered = null;

    // 1. Check characters
    for (const [key, agent] of Object.entries(characters)) {
      const dist = Math.hypot(worldX - agent.x, worldY - agent.y);
      if (dist < 26) {
        hovered = {
          type: 'agent',
          title: `${agent.emoji} ${agent.fullName}`,
          desc: `Status: ${agent.state} • Klik untuk fokus & follow`
        };
        break;
      }
    }

    // 2. Check interactive furniture
    if (!hovered) {
      if (worldX >= 70 && worldX <= 120 && worldY >= 30 && worldY <= 60) {
        hovered = { type: 'furniture', title: '☕ Mesin Espresso Premium', desc: 'Klik untuk menyeduh secangkir kopi segar!' };
      } else if (worldX >= 620 && worldX <= 880 && worldY >= 30 && worldY <= 80) {
        hovered = { type: 'furniture', title: '📊 Sprint Meeting Board', desc: 'Papan tulis Kanban & burndown roadmap aktif.' };
      } else if (worldX >= 840 && worldX <= 930 && worldY >= 410 && worldY <= 630) {
        hovered = { type: 'furniture', title: '🛡️ Server Rack Clusters', desc: 'Cluster database & load balancer (Uptime: 99.98%).' };
      }
    }

    // 3. Check rooms for room zoom preview
    if (!hovered) {
      if (worldX >= 30 && worldX <= 496 && worldY >= 30 && worldY <= 330) {
        hovered = { type: 'room', title: '☕ Coffee Lounge & Pantry', desc: 'Klik untuk zoom & isolasi ruangan ini' };
      } else if (worldX >= 504 && worldX <= 970 && worldY >= 30 && worldY <= 330) {
        hovered = { type: 'room', title: '📊 Scrum & Meeting Room', desc: 'Klik untuk zoom & isolasi ruangan ini' };
      } else if (worldX >= 30 && worldX <= 496 && worldY >= 370 && worldY <= 670) {
        hovered = { type: 'room', title: '💻 Developer Cubicles', desc: 'Klik untuk zoom & isolasi ruangan ini' };
      } else if (worldX >= 504 && worldX <= 970 && worldY >= 370 && worldY <= 670) {
        hovered = { type: 'room', title: '🛡️ QA & Server Room', desc: 'Klik untuk zoom & isolasi ruangan ini' };
      }
    }

    if (hovered) {
      if (hoverInfo) {
        hoverInfo.innerHTML = `<strong>${hovered.title}</strong><span class="hover-desc">${hovered.desc}</span>`;
        hoverInfo.classList.add('visible');
      }
      canvas.style.cursor = 'pointer';
    } else {
      if (hoverInfo) {
        hoverInfo.innerHTML = '';
        hoverInfo.classList.remove('visible');
      }
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (hoverInfo) {
      hoverInfo.innerHTML = '';
      hoverInfo.classList.remove('visible');
    }
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Unproject to world coordinates
    const world = renderer.screenToWorld(mouseX, mouseY);
    const worldX = world.x;
    const worldY = world.y;

    // 1. Click on Character -> Focus & Follow
    for (const [key, agent] of Object.entries(characters)) {
      const dist = Math.hypot(worldX - agent.x, worldY - agent.y);
      if (dist < 26) {
        soundFx.playClick();
        if (key === 'daisy') {
          openDaisyModal();
          return;
        }
        if (renderer.camera.followingAgent === agent) {
          renderer.resetCamera();
        } else {
          renderer.followAgent(agent);
          agent.say(`Hai! Saya ${agent.name}, ${agent.role}.`, 200);
        }
        return;
      }
    }

    // 2. Click on Interactive Furniture
    // Front Desk Bell
    if (worldX >= 435 && worldX <= 455 && worldY >= 730 && worldY <= 750) {
      soundFx.playBell();
      if (characters.daisy) characters.daisy.say('Ting! Halo, ada yang bisa Daisy bantu? 🛎️', 200);
      openDaisyModal();
      return;
    }

    // Espresso Machine
    if (worldX >= 70 && worldX <= 120 && worldY >= 30 && worldY <= 60) {
      soundFx.playCoffee();
      for (let i = 0; i < 6; i++) {
        renderer.addCoffeeSteam(90, 30);
      }
      showToast('info', '☕ Kopi espresso berhasil diseduh! Wangi kopi menyebar...');
      return;
    }

    // Meeting Board
    if (worldX >= 620 && worldX <= 880 && worldY >= 30 && worldY <= 80) {
      soundFx.playBell();
      showToast('info', '📊 Meeting Board diperbarui dengan sprint roadmap terkini.');
      return;
    }

    // Server Rack
    if (worldX >= 840 && worldX <= 930 && worldY >= 410 && worldY <= 630) {
      soundFx.playKeyboard();
      showToast('info', '🛡️ Server Cluster: Ping 1ms | Uptime 99.98% | CPU 24%');
      return;
    }

    // 3. Click on Room -> Zoom into Room (Toggle Full View)
    if (worldX >= 30 && worldX <= 496 && worldY >= 30 && worldY <= 330) {
      toggleRoomZoom('pantry');
      return;
    }
    if (worldX >= 504 && worldX <= 970 && worldY >= 30 && worldY <= 330) {
      toggleRoomZoom('war_room');
      return;
    }
    if (worldX >= 30 && worldX <= 496 && worldY >= 370 && worldY <= 670) {
      toggleRoomZoom('dev_cubicles');
      return;
    }
    if (worldX >= 504 && worldX <= 970 && worldY >= 370 && worldY <= 670) {
      toggleRoomZoom('qa_server');
      return;
    }
    if (worldX >= 30 && worldX <= 970 && worldY >= 676 && worldY <= 850) {
      toggleRoomZoom('front_desk');
      return;
    }

    // 4. Clicked Hallway or outer borders while zoomed
    if (renderer.isZoomed()) {
      renderer.resetCamera();
      soundFx.playClick();
    }
  });
}

/**
 * 6. Sprint Backlog Form, Weekly Sprint Cycles, & Queue Rendering
 */
function toggleAddTaskCollapse() {
  const card = document.getElementById('addTaskCard');
  if (!card) return;
  card.classList.toggle('collapsed');
  const isCollapsed = card.classList.contains('collapsed');

  const toggleBtn = document.getElementById('toggleAddTaskBtn');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));

  const icon = document.getElementById('addTaskCollapseIcon');
  if (icon) icon.textContent = isCollapsed ? '▲' : '▼';

  soundFx.playClick();
}

function updateSprintWeekDropdown() {
  const select = document.getElementById('sprintWeekSelect');
  const titleEl = document.getElementById('sprintWeekProgressTitle');
  if (!select) return;

  const currentVal = sprintManager.currentWeek;
  select.innerHTML = '';
  sprintManager.weeks.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = `Sprint Minggu ${w}`;
    if (w === currentVal) opt.selected = true;
    select.appendChild(opt);
  });

  if (titleEl) {
    titleEl.textContent = `Kemajuan Sprint Minggu ${currentVal}`;
  }
}

function handleSprintWeekChange(e) {
  const week = parseInt(e.target.value, 10) || 1;
  sprintManager.setWeek(week);
  soundFx.playClick();
  showToast('info', `📅 Beralih ke Sprint Minggu ${week}`);
}

function handleCreateNewSprintWeek() {
  const newWeek = sprintManager.createNewWeek();
  soundFx.playClick();
  showToast('success', `✨ Sprint Minggu ${newWeek} baru telah dibuat!`);
}

function handleAddTaskSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('taskTitle').value;
  const desc = document.getElementById('taskDesc').value;
  const priority = document.getElementById('taskPriority').value;

  if (!title.trim() || !desc.trim()) return;

  sprintManager.addTask(title, desc, priority, sprintManager.currentWeek);

  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDesc').value = '';
  showToast('success', `Task berhasil ditambahkan ke Sprint Minggu ${sprintManager.currentWeek}!`);
}

function applyPreset(presetKey) {
  const presets = {
    auth: {
      title: 'Sistem Autentikasi JWT & Role Permission (Admin, Manager, Staff)',
      desc: 'Implementasi API login/register, token JWT, hashing password Argon2ID, dan middleware hak akses bertingkat dengan CodeIgniter 4 dan MySQL.',
      priority: '1'
    },
    inventory: {
      title: 'Modul Manajemen Produk & Peringatan Stok Rendah (REST API & Alert)',
      desc: 'CRUD produk inventaris, log pergerakan stok (in/out), perhitungan otomatis, dan trigger peringatan jika stok di bawah ambang batas.',
      priority: '2'
    },
    payment: {
      title: 'Integrasi Checkout Transaksi & Webhook Payment Gateway',
      desc: 'Pembuatan endpoint order checkout, verifikasi signature webhook pembayaran otomatis, rollback transaksi jika stok habis, dan receipt email.',
      priority: '1'
    }
  };

  const p = presets[presetKey];
  if (p) {
    document.getElementById('taskTitle').value = p.title;
    document.getElementById('taskDesc').value = p.desc;
    document.getElementById('taskPriority').value = p.priority;
    soundFx.playClick();
  }
}

/**
 * Workflow strip (per-task agent chain decided by the Scrum Master) + rollback
 */
function renderWorkflowStrip(task) {
  const wf = task.workflow;
  // task.workflow is persisted as { steps: [...] }; also tolerate a bare array.
  const steps = Array.isArray(wf) ? wf : (wf && Array.isArray(wf.steps) ? wf.steps : []);
  if (steps.length === 0) return '';

  const icons = { scrum_master: '👑', system_architect: '📐', backend_dev: '⚡', frontend_dev: '🎨', qa_engineer: '🛡️' };
  const states = task.stepStates || {};
  const outs = task.outputs || {};

  const chips = steps.map(s => {
    const key = (typeof s === 'string') ? s : (s.agent || s.key);
    const st = states[key] || (outs[key] ? 'DONE' : 'PENDING');
    const cls = st === 'DONE' ? 'wf-done' : st === 'FAILED' ? 'wf-failed' : st === 'RUNNING' ? 'wf-running' : 'wf-pending';
    return `<span class="wf-chip ${cls}" title="${escapeHtml(String(key))}: ${escapeHtml(String(st))}">${icons[key] || '•'}</span>`;
  }).join('');

  return `<div class="kanban-card-workflow" title="Alur kerja task ini (ditentukan Scrum Master)">${chips}</div>`;
}

function handleTaskRollback(taskId) {
  const task = sprintManager.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!confirm(`Rollback task "${task.title}" satu tahap ke belakang?\nOutput tahap terakhir akan dihapus dan task kembali ke To Do.`)) return;

  const ok = (typeof sprintManager.rollbackStep === 'function') ? sprintManager.rollbackStep(taskId, 1) : false;
  soundFx.playClick();
  showToast(ok ? 'success' : 'info', ok ? '↩ Rollback berhasil. Task kembali ke To Do.' : 'Rollback tidak tersedia untuk task ini.');
  renderBacklogUI();
  updateDeliverablesDropdown();
}

/**
 * Kanban Board Rendering & Drag-and-Drop Handlers
 */
function renderBacklogUI() {
  const countBadge = document.getElementById('backlogCountBadge');
  const progressBar = document.getElementById('sprintProgressBar');
  const progressLabel = document.getElementById('sprintProgressLabel');

  updateSprintWeekDropdown();

  const tasks = sprintManager.getWeekTasks();
  if (countBadge) countBadge.textContent = tasks.length;

  const completed = tasks.filter(t => t.status === 'DONE').length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (progressBar) {
    progressBar.style.width = `${pct}%`;
    progressBar.classList.toggle('complete', pct >= 100);
  }
  if (progressLabel) progressLabel.textContent = `${completed} / ${total} Selesai (${pct}%)`;

  const colPending = document.getElementById('cards_PENDING');
  const colProgress = document.getElementById('cards_IN_PROGRESS');
  const colError = document.getElementById('cards_ERROR');
  const colDone = document.getElementById('cards_DONE');

  if (!colPending || !colProgress || !colError || !colDone) return;

  colPending.innerHTML = '';
  colProgress.innerHTML = '';
  colError.innerHTML = '';
  colDone.innerHTML = '';

  const counts = { PENDING: 0, IN_PROGRESS: 0, ERROR: 0, DONE: 0 };
  const prioLabels = { 1: '1-Crit', 2: '2-High', 3: '3-Med', 4: '4-Low' };
  const prioClasses = { 1: 'prio-1', 2: 'prio-2', 3: 'prio-3', 4: 'prio-4' };

  tasks.forEach(task => {
    const status = task.status || 'PENDING';
    if (counts[status] !== undefined) counts[status]++;

    const card = document.createElement('div');
    const isActive = (status === 'IN_PROGRESS');
    const isDone = (status === 'DONE');
    const isError = (status === 'ERROR');

    card.className = `kanban-card ${isActive ? 'active-task' : ''} ${isDone ? 'done-task' : ''} ${isError ? 'error-task' : ''}`;
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-task-id', task.id);
    card.ondragstart = (e) => handleKanbanDragStart(e, task.id);
    card.ondragend = (e) => e.target.classList.remove('dragging');

    // Build mentioned files tags if any
    let fileTagsHtml = '';
    if (task.mentionedFiles && task.mentionedFiles.length > 0) {
      fileTagsHtml = `
        <div class="kanban-card-files">
          ${task.mentionedFiles.map(f => `<span class="file-badge-tag" title="File target: ${escapeHtml(f)}">📄 ${escapeHtml(f.split('/').pop())}</span>`).join('')}
        </div>
      `;
    }

    const workflowStrip = renderWorkflowStrip(task);
    const hasProgress = Object.keys(task.outputs || {}).length > 0 ||
      Object.keys(task.stepStates || {}).some(k => task.stepStates[k] && task.stepStates[k] !== 'PENDING');

    let statusPill = '';
    if (isActive) {
      statusPill = `<span class="badge" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; font-size: 9px;">⚡ ${task.activeAgent || 'Tim'}</span>`;
    } else if (isDone) {
      statusPill = `<span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e; font-size: 9px;">✓ Selesai</span>`;
    } else if (isError) {
      statusPill = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; font-size: 9px;" title="${escapeHtml(task.lastError || '')}">⚠️ Error</span>`;
    } else {
      statusPill = `<span class="badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; font-size: 9px;">To Do</span>`;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span class="priority-pill ${prioClasses[task.priority]}" style="font-size: 8px; padding: 1px 4px;">${prioLabels[task.priority]}</span>
        <span style="font-size: 9px; color: var(--text-muted); font-family: var(--font-mono);">${task.id}</span>
      </div>
      <div class="kanban-card-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
      <div class="kanban-card-desc" title="${escapeHtml(task.description)}">${escapeHtml(task.description)}</div>
      ${fileTagsHtml}
      ${workflowStrip}
      <div class="kanban-card-footer">
        <div>${statusPill}</div>
        <div style="display: flex; gap: 4px;">
          ${isDone ? `<button class="btn-xs" onclick="viewTaskDeliverables('${task.id}')" title="Lihat kode deliverable">Kode</button>` : ''}
          ${hasProgress ? `<button class="btn-xs" onclick="handleTaskRollback('${task.id}')" title="Rollback satu tahap terakhir">↩ Mundur</button>` : ''}
          ${isError ? `<button class="btn-xs warning" style="background:#f59e0b;color:#0f172a;font-weight:bold;" onclick="sprintManager.startSprint()" title="Lanjutkan pengerjaan task ini">▶ Lanjut</button>` : ''}
          <button class="btn-xs danger" onclick="sprintManager.deleteTask('${task.id}')" title="Hapus task">✕</button>
        </div>
      </div>
    `;

    if (status === 'IN_PROGRESS') {
      colProgress.appendChild(card);
    } else if (status === 'ERROR') {
      colError.appendChild(card);
    } else if (status === 'DONE') {
      colDone.appendChild(card);
    } else {
      colPending.appendChild(card);
    }
  });

  // Empty state hints for columns
  const emptyState = (text) => `<div style="text-align: center; padding: 20px 8px; color: var(--text-muted); font-size: 10px; font-style: italic;">${text}</div>`;
  if (counts.PENDING === 0) colPending.innerHTML = emptyState('Tidak ada task');
  if (counts.IN_PROGRESS === 0) colProgress.innerHTML = emptyState('Tidak ada aktif');
  if (counts.ERROR === 0) colError.innerHTML = emptyState('Nihil kendala');
  if (counts.DONE === 0) colDone.innerHTML = emptyState('Belum selesai');

  // Update header badges
  const bPending = document.getElementById('badge_col_pending');
  const bProgress = document.getElementById('badge_col_in_progress');
  const bError = document.getElementById('badge_col_error');
  const bDone = document.getElementById('badge_col_done');
  if (bPending) bPending.textContent = counts.PENDING;
  if (bProgress) bProgress.textContent = counts.IN_PROGRESS;
  if (bError) bError.textContent = counts.ERROR;
  if (bDone) bDone.textContent = counts.DONE;
}

function handleKanbanDragStart(e, taskId) {
  e.dataTransfer.setData('text/plain', taskId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
}

function handleKanbanDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.currentTarget;
  if (!col.classList.contains('drag-over')) {
    col.classList.add('drag-over');
  }
}

function handleKanbanDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function handleKanbanDrop(e, targetStatus) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const taskId = e.dataTransfer.getData('text/plain');
  if (!taskId) return;
  sprintManager.updateTaskStatus(taskId, targetStatus);
}

function handleClearCompletedTasks() {
  sprintManager.clearCompletedTasks();
  showToast('info', `Task selesai pada Minggu ${sprintManager.currentWeek} telah dibersihkan.`);
}

/**
 * Project Context Selector & Multiple Projects Management
 */
function initProjectSelector() {
  const select = document.getElementById('activeProjectSelect');
  if (!select) return;

  const projects = sprintManager.getProjects();
  const active = sprintManager.getActiveProject();

  select.innerHTML = '';
  if (projects.length === 0) {
    select.innerHTML = '<option value="">(Belum ada proyek)</option>';
    return;
  }

  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.fileCount || 0} file)`;
    if (active && active.id === p.id) opt.selected = true;
    select.appendChild(opt);
  });
}

function handleActiveProjectChange(e) {
  const projId = e.target.value;
  sprintManager.setActiveProject(projId);
  const active = sprintManager.getActiveProject();
  if (active) {
    showToast('info', `📁 Beralih ke proyek: ${active.name}`);
  }
}

function openProjectModal() {
  showPage('page-projects');
  renderProjectListModal();
  soundFx.playClick();
}

function closeProjectModal() {
  showPage('page-office');
  soundFx.playClick();
}

function renderProjectListModal() {
  const container = document.getElementById('projectListContainer');
  if (!container) return;

  const projects = sprintManager.getProjects();
  const active = sprintManager.getActiveProject();

  if (projects.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 12px; font-size: 11px;">Belum ada proyek terdaftar. Tambahkan di atas!</div>`;
    return;
  }

  container.innerHTML = '';
  projects.forEach(p => {
    const isActive = active && active.id === p.id;
    const item = document.createElement('div');
    item.className = `project-item ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 12px; color: #fff;">
          ${escapeHtml(p.name)} ${isActive ? '<span class="badge" style="background:#22c55e;color:#000;font-size:9px;">AKTIF</span>' : ''}
        </div>
        <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">
          ${escapeHtml(p.path)} • ${p.fileCount || 0} file terindeks
        </div>
      </div>
      <div style="display: flex; gap: 6px;">
        ${!isActive ? `<button class="btn-xs primary" onclick="selectActiveProject('${p.id}')">Pilih</button>` : ''}
        <button class="btn-xs" onclick="rescanProject('${p.id}')" title="Pindai ulang file">🔄</button>
        <button class="btn-xs danger" onclick="deleteProject('${p.id}')" title="Hapus proyek">✕</button>
      </div>
    `;
    container.appendChild(item);
  });
}

async function handleAddProjectSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('newProjName').value.trim();
  const rawPath = document.getElementById('newProjPath').value.trim();
  if (!name || !rawPath) return;

  const btn = document.getElementById('btnScanNewProject');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Memindai direktori...';
  }

  try {
    const res = await fetch('/api/project/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rawPath })
    });
    const data = await res.json();
    if (!data.success) {
      alert(`Gagal memindai folder: ${data.error}`);
      return;
    }

    const projects = sprintManager.getProjects();
    const newProj = {
      id: 'proj_' + Date.now(),
      name: name,
      path: data.path,
      files: data.files || [],
      fileCount: data.count || 0
    };
    projects.push(newProj);
    sprintManager.saveProjects(projects);
    sprintManager.setActiveProject(newProj.id);

    initProjectSelector();
    renderProjectListModal();
    document.getElementById('newProjName').value = '';
    document.getElementById('newProjPath').value = '';
    showToast('success', `✓ Proyek "${name}" berhasil didaftarkan (${data.count} file)!`);
  } catch (err) {
    alert(`Terjadi kesalahan koneksi server: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔍 Validasi & Pindai File Proyek';
    }
  }
}

function selectActiveProject(projId) {
  sprintManager.setActiveProject(projId);
  initProjectSelector();
  renderProjectListModal();
  soundFx.playClick();
  const active = sprintManager.getActiveProject();
  if (active) showToast('info', `Proyek aktif: ${active.name}`);
}

async function rescanProject(projId) {
  const projects = sprintManager.getProjects();
  const p = projects.find(x => x.id === projId);
  if (!p) return;

  try {
    const res = await fetch('/api/project/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p.path })
    });
    const data = await res.json();
    if (data.success) {
      p.files = data.files || [];
      p.fileCount = data.count || 0;
      sprintManager.saveProjects(projects);
      initProjectSelector();
      renderProjectListModal();
      showToast('success', `✓ Berhasil memindai ulang ${p.name} (${p.fileCount} file)!`);
    } else {
      alert(`Gagal rescan: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function deleteProject(projId) {
  let projects = sprintManager.getProjects();
  projects = projects.filter(x => x.id !== projId);
  sprintManager.saveProjects(projects);
  const active = sprintManager.getActiveProject();
  if (active) sprintManager.setActiveProject(active.id);
  initProjectSelector();
  renderProjectListModal();
  soundFx.playClick();
  showToast('info', 'Proyek dihapus.');
}

/**
 * @file Autocomplete System for Task Creation
 */
function initFileAutocomplete() {
  const inputs = [document.getElementById('taskTitle'), document.getElementById('taskDesc')];
  const dropdown = document.getElementById('fileAutocompleteDropdown');
  if (!dropdown) return;

  let activeInput = null;
  let selectedIndex = -1;
  let matches = [];

  inputs.forEach(input => {
    if (!input) return;

    input.addEventListener('input', () => {
      activeInput = input;
      const text = input.value;
      const cursorPos = input.selectionStart;

      const textBeforeCursor = text.substring(0, cursorPos);
      const match = textBeforeCursor.match(/@([a-zA-Z0-9_\-\.\/]*)$/);

      if (!match) {
        dropdown.style.display = 'none';
        return;
      }

      const query = match[1].toLowerCase();
      const activeProj = sprintManager.getActiveProject();
      const files = activeProj?.files || [];

      matches = files.filter(f => f.toLowerCase().includes(query)).slice(0, 15);

      if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      selectedIndex = 0;
      dropdown.innerHTML = '';
      matches.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = `file-autocomplete-item ${idx === selectedIndex ? 'selected' : ''}`;
        item.innerHTML = `
          <span>📄 ${escapeHtml(file)}</span>
          <span style="font-size: 9px; color: var(--accent-cyan);">Pilih</span>
        `;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          insertFileMention(input, match[0], file);
          dropdown.style.display = 'none';
        });
        dropdown.appendChild(item);
      });

      const rect = input.getBoundingClientRect();
      const formRect = input.form.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom - formRect.top + 4}px`;
      dropdown.style.left = `${rect.left - formRect.left}px`;
      dropdown.style.width = `${rect.width}px`;
      dropdown.style.display = 'block';
    });

    input.addEventListener('keydown', (e) => {
      if (dropdown.style.display !== 'block' || matches.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % matches.length;
        updateAutocompleteSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
        updateAutocompleteSelection();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (selectedIndex >= 0 && selectedIndex < matches.length) {
          e.preventDefault();
          const textBeforeCursor = input.value.substring(0, input.selectionStart);
          const match = textBeforeCursor.match(/@([a-zA-Z0-9_\-\.\/]*)$/);
          if (match) {
            insertFileMention(input, match[0], matches[selectedIndex]);
          }
          dropdown.style.display = 'none';
        }
      } else if (e.key === 'Escape') {
        dropdown.style.display = 'none';
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.style.display = 'none';
      }, 200);
    });
  });

  function updateAutocompleteSelection() {
    const items = dropdown.querySelectorAll('.file-autocomplete-item');
    items.forEach((item, idx) => {
      if (idx === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function insertFileMention(input, rawMatch, chosenFile) {
    const cursorPos = input.selectionStart;
    const text = input.value;
    const before = text.substring(0, cursorPos - rawMatch.length);
    const after = text.substring(cursorPos);
    const insertion = `@${chosenFile} `;
    input.value = before + insertion + after;
    input.selectionStart = input.selectionEnd = before.length + insertion.length;
    input.focus();
    soundFx.playClick();
  }
}

/**
 * Daisy Front Desk Modal & Interactive Q&A
 */
function openDaisyModal() {
  showPage('page-daisy');
  soundFx.playClick();
  const input = document.getElementById('daisyQuestionInput');
  if (input) setTimeout(() => input.focus(), 100);
}

function closeDaisyModal() {
  showPage('page-office');
  soundFx.playClick();
}

function sendDaisyQuickQuestion(text) {
  const input = document.getElementById('daisyQuestionInput');
  if (input) {
    input.value = text;
    handleDaisyQuestionSubmit(new Event('submit'));
  }
}

async function handleDaisyQuestionSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById('daisyQuestionInput');
  const stream = document.getElementById('daisyChatStream');
  if (!input || !stream) return;

  const question = input.value.trim();
  if (!question) return;

  // Append user message
  const userMsg = document.createElement('div');
  userMsg.className = 'daisy-msg user';
  userMsg.innerHTML = `<div class="daisy-msg-bubble">${escapeHtml(question)}</div>`;
  stream.appendChild(userMsg);
  input.value = '';
  stream.scrollTop = stream.scrollHeight;

  // Add Daisy waiting bubble
  const daisyWaiting = document.createElement('div');
  daisyWaiting.className = 'daisy-msg daisy';
  daisyWaiting.innerHTML = `
    <span class="daisy-msg-icon">🛎️</span>
    <div class="daisy-msg-bubble" style="color: var(--text-muted); font-style: italic;">
      Daisy sedang berpikir... ✨
    </div>
  `;
  stream.appendChild(daisyWaiting);
  stream.scrollTop = stream.scrollHeight;

  soundFx.playClick();
  if (characters.daisy) {
    characters.daisy.say('Menjawab pertanyaan di Front Desk... ✨', 200);
  }

  try {
    const answer = await llmClient.askDaisy(question);
    daisyWaiting.querySelector('.daisy-msg-bubble').innerHTML = formatChatText(answer);
    stream.scrollTop = stream.scrollHeight;

    // Record in Live Chat history so persisted
    sprintManager.addChatLog(
      'daisy',
      characters.daisy ? characters.daisy.fullName : 'Daisy (Front Desk)',
      'Tanya Jawab Front Desk',
      `**Q**: ${question}\n\n**Daisy**: ${answer}`
    );

    if (characters.daisy) {
      characters.daisy.say('Sudah saya jawab di resepsionis ya! 😊', 220);
    }
  } catch (err) {
    daisyWaiting.querySelector('.daisy-msg-bubble').innerHTML = `<span style="color:#ef4444;">⚠️ Maaf, terjadi kendala: ${escapeHtml(err.message)}</span>`;
  }
}

function handleClearChatLog() {
  if (confirm('Bersihkan seluruh riwayat chat kantor?')) {
    sprintManager.clearChatLog();
    renderChatLogUI();
    showToast('info', 'Riwayat chat kantor telah dibersihkan.');
  }
}

function getAgentDisplayName(agentKey, fallbackName) {
  if (agentKey === 'system') return 'System';
  const map = {
    scrum: 'scrum_master',
    architect: 'system_architect',
    backend: 'backend_dev',
    frontend: 'frontend_dev',
    qa: 'qa_engineer',
    daisy: 'daisy',
    reception: 'daisy'
  };
  const id = map[agentKey] || agentKey;
  if (typeof characters !== 'undefined' && characters[id]) {
    const char = characters[id];
    return char.fullName || `${char.name} (${char.role || char.tag})`;
  }
  if (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.agents && OFFICE_CONFIG.agents[id]) {
    const ag = OFFICE_CONFIG.agents[id];
    return ag.fullName || `${ag.name} (${ag.role || ag.tag})`;
  }
  return fallbackName;
}

function updateChatFilterLabels() {
  const map = {
    daisy: 'daisy',
    scrum: 'scrum_master',
    architect: 'system_architect',
    backend: 'backend_dev',
    frontend: 'frontend_dev',
    qa: 'qa_engineer'
  };
  const icons = {
    daisy: '🛎️',
    scrum: '👑',
    architect: '📐',
    backend: '⚡',
    frontend: '🎨',
    qa: '🛡️'
  };
  for (const [filterKey, agentKey] of Object.entries(map)) {
    const btn = document.querySelector(`.filter-chip[data-filter="${filterKey}"]`);
    if (btn) {
      const char = (typeof characters !== 'undefined' && characters[agentKey]) || (OFFICE_CONFIG.agents && OFFICE_CONFIG.agents[agentKey]);
      if (char) {
        btn.textContent = `${icons[filterKey]} ${char.name}`;
      }
    }
  }
}

/**
 * 7. Live Office Chat Stream & Code Output
 */
function appendChatLogItem(logItem) {
  const stream = document.getElementById('chatStreamContainer');
  if (!stream) return;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${logItem.agentKey}`;
  bubble.setAttribute('data-agent', logItem.agentKey);

  const icons = {
    daisy: '🛎️',
    reception: '🛎️',
    scrum: '👑',
    architect: '📐',
    backend: '⚡',
    frontend: '🎨',
    qa: '🛡️',
    system: '🏢'
  };

  const displayName = getAgentDisplayName(logItem.agentKey, logItem.senderName);

  bubble.innerHTML = `
    <div class="chat-sender-row">
      <div class="sender-info">
        <span class="sender-avatar">${icons[logItem.agentKey] || '💬'}</span>
        <span class="sender-name">${escapeHtml(displayName)}</span>
      </div>
      <span class="chat-time">${logItem.timestamp}</span>
    </div>
    <div class="chat-text"><strong>${escapeHtml(logItem.title)}:</strong> ${formatChatText(logItem.text)}</div>
    ${logItem.codeSnippet ? `
      <div class="code-snippet-box">
        <div class="code-snippet-header">
          <span>Preview Output</span>
        </div>
        <div class="code-snippet-body">${escapeHtml(logItem.codeSnippet)}</div>
      </div>
    ` : ''}
  `;

  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;
}

function renderChatLogUI() {
  const stream = document.getElementById('chatStreamContainer');
  if (!stream) return;
  stream.innerHTML = '';
  sprintManager.chatLog.forEach(log => appendChatLogItem(log));
}

function filterChatStream(filterKey) {
  const bubbles = document.querySelectorAll('#chatStreamContainer .chat-bubble');
  bubbles.forEach(b => {
    if (filterKey === 'all' || b.getAttribute('data-agent') === filterKey) {
      b.style.display = 'block';
    } else {
      b.style.display = 'none';
    }
  });
}

/**
 * 8. Deliverable Code Viewer Drawer
 */
function updateDeliverablesDropdown() {
  const select = document.getElementById('deliverableTaskSelect');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '';

  const tasksWithOutputs = sprintManager.tasks.filter(t => Object.keys(t.outputs).length > 0 || t.status === 'IN_PROGRESS' || t.status === 'DONE');

  if (tasksWithOutputs.length === 0) {
    select.innerHTML = '<option value="">(Belum ada task yang diproses)</option>';
    updateDeliverableContentDisplay();
    return;
  }

  tasksWithOutputs.forEach(task => {
    const opt = document.createElement('option');
    opt.value = task.id;
    opt.textContent = `[Minggu ${task.week || 1}] ${task.id}: ${task.title}`;
    select.appendChild(opt);
  });

  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }

  updateDeliverableContentDisplay();
}

function getSelectedDeliverableTaskId() {
  const select = document.getElementById('deliverableTaskSelect');
  return select ? select.value : null;
}

function viewTaskDeliverables(taskId) {
  // Route to the dedicated Kode Output page
  showPage('page-code');

  const select = document.getElementById('deliverableTaskSelect');
  if (select) {
    select.value = taskId;
    updateDeliverableContentDisplay();
  }
}

function showDeliverableContent(agentKey) {
  if (agentKey) {
    selectedDeliverableAgent = agentKey;
    document.querySelectorAll('.d-tab-btn').forEach(b => {
      if (b.getAttribute('data-dtab') === agentKey) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }
  updateDeliverableContentDisplay();
}

function updateDeliverableContentDisplay() {
  const taskId = getSelectedDeliverableTaskId();
  const titleEl = document.getElementById('codeViewerTitle');
  const contentEl = document.getElementById('codeViewerContent');

  if (!taskId) {
    titleEl.textContent = 'Deliverable Output';
    contentEl.textContent = 'Pilih task di atas atau jalankan sprint untuk melihat hasil pekerjaan para agen.';
    return;
  }

  const task = sprintManager.tasks.find(t => t.id === taskId);
  if (!task || !task.outputs) {
    contentEl.textContent = 'Belum ada output yang tercatat.';
    return;
  }

  const agentConfig = OFFICE_CONFIG.agents[selectedDeliverableAgent];
  titleEl.textContent = `${agentConfig ? agentConfig.emoji : '📄'} ${agentConfig ? agentConfig.role : selectedDeliverableAgent}`;

  const deliverableText = task.outputs[selectedDeliverableAgent];
  if (deliverableText) {
    contentEl.textContent = deliverableText;
  } else {
    contentEl.textContent = `Agen ${agentConfig ? agentConfig.name : selectedDeliverableAgent} belum menyelesaikan deliverable untuk task ini.`;
  }
}

function handleCopyCurrentCode() {
  const contentEl = document.getElementById('codeViewerContent');
  if (!contentEl || !contentEl.textContent) return;

  navigator.clipboard.writeText(contentEl.textContent).then(() => {
    soundFx.playClick();
    showToast('success', 'Kode berhasil disalin ke clipboard!');
  }).catch(() => {
    showToast('error', 'Gagal menyalin kode ke clipboard.');
  });
}

/**
 * 8b. File Deliverables: Diff, Apply & Open in External Editor
 */
function getEditorPref() {
  return localStorage.getItem('voffice_editor_pref') || 'antigravity';
}

function handleSaveEditorPref(e) {
  const val = (e && e.target && e.target.value) ? e.target.value : 'antigravity';
  localStorage.setItem('voffice_editor_pref', val);
  soundFx.playClick();
  showToast('success', `Editor eksternal diset ke "${val}".`);
}

function getActiveProjectPath() {
  const p = (typeof sprintManager !== 'undefined' && sprintManager.getActiveProject) ? sprintManager.getActiveProject() : null;
  return p ? p.path : null;
}

// Collect {path, content} deliverables for a task (task.deliverables, or parsed from outputs).
function collectTaskDeliverables(task) {
  if (!task) return [];
  const files = [];
  if (Array.isArray(task.deliverables)) files.push(...task.deliverables);

  if (files.length === 0 && typeof llmClient !== 'undefined' && typeof llmClient.parseDeliverables === 'function' && task.outputs) {
    for (const agentKey of Object.keys(task.outputs)) {
      const parsed = llmClient.parseDeliverables(task.outputs[agentKey] || '');
      if (Array.isArray(parsed)) files.push(...parsed);
    }
  }

  const map = new Map();
  files.forEach(f => { if (f && f.path && typeof f.content === 'string') map.set(f.path, f); });
  return Array.from(map.values());
}

async function handleViewDiff() {
  const projectPath = getActiveProjectPath();
  const panel = document.getElementById('diffPanel');
  const content = document.getElementById('diffContent');
  if (!projectPath) { showToast('error', 'Tidak ada proyek aktif.'); return; }
  if (panel) panel.style.display = 'block';
  if (content) content.textContent = 'Memuat diff...';
  try {
    const res = await fetch(`/api/files/diff?projectPath=${encodeURIComponent(projectPath)}`);
    const data = await res.json();
    if (!data.success) {
      if (content) content.textContent = `Gagal mengambil diff: ${data.error || 'tidak diketahui'}\n\n(Pastikan aplikasi dijalankan dengan "node server.js", bukan "python -m http.server".)`;
      return;
    }
    const parts = [];
    if (data.status && data.status.trim()) parts.push('# git status --porcelain\n' + data.status.trim());
    if (data.diff && data.diff.trim()) parts.push('# git diff --no-color\n' + data.diff);
    if (parts.length === 0) parts.push('Tidak ada perubahan terdeteksi pada working tree.');
    if (content) content.textContent = parts.join('\n\n');
  } catch (err) {
    if (content) content.textContent = `Error: ${err.message}\n\n(Pastikan server Node aktif: node server.js)`;
  }
}

async function handleApplyDeliverables() {
  const projectPath = getActiveProjectPath();
  if (!projectPath) { showToast('error', 'Tidak ada proyek aktif.'); return; }
  const taskId = getSelectedDeliverableTaskId();
  const task = sprintManager.tasks.find(t => t.id === taskId);
  const files = collectTaskDeliverables(task);
  if (files.length === 0) {
    showToast('info', 'Tidak ada file deliverable (@file:path) pada task ini untuk diterapkan.');
    return;
  }
  const list = files.map(f => `- ${f.path}`).join('\n');
  if (!confirm(`Terapkan ${files.length} file ke folder proyek?\n\n${list}\n\nFile lama akan di-backup ke .voffice_backups/`)) return;
  try {
    const res = await fetch('/api/files/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, files, backup: true })
    });
    const data = await res.json();
    if (!data.success) { showToast('error', `Gagal menerapkan: ${data.error}`); return; }
    soundFx.playComplete();
    showToast('success', `✓ ${data.applied.length} file diterapkan (backup: ${data.backupDir || '-'})`);
    handleViewDiff();
  } catch (err) {
    showToast('error', `Error: ${err.message} (butuh node server.js)`);
  }
}

async function handleOpenInEditor() {
  const projectPath = getActiveProjectPath();
  if (!projectPath) { showToast('error', 'Tidak ada proyek aktif.'); return; }
  const taskId = getSelectedDeliverableTaskId();
  const task = sprintManager.tasks.find(t => t.id === taskId);
  const files = collectTaskDeliverables(task);
  const editor = getEditorPref();
  if (files.length === 0) {
    showToast('info', 'Tidak ada file deliverable untuk dibuka.');
    return;
  }
  let opened = 0;
  for (const f of files) {
    try {
      const res = await fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, filePath: f.path, editor })
      });
      const data = await res.json();
      if (data.success) opened++;
      else showToast('error', data.error || `Gagal membuka ${f.path}`);
    } catch (err) {
      showToast('error', `Error membuka editor: ${err.message}`);
      break;
    }
  }
  if (opened > 0) showToast('success', `🚀 ${opened} file dibuka di ${editor}.`);
}

// Warn (once) when the Node API is unavailable (e.g. served by python http.server).
async function checkServerApi() {
  let ok = false;
  try {
    const res = await fetch('/api/health');
    ok = res.ok;
  } catch (e) { ok = false; }

  if (!ok && !document.getElementById('serverApiWarning')) {
    const nav = document.getElementById('pageNav');
    const banner = document.createElement('div');
    banner.id = 'serverApiWarning';
    banner.className = 'server-api-warning';
    banner.innerHTML = '⚠️ <strong>Fitur file / diff / meeting nonaktif.</strong> Jalankan aplikasi dengan <code>node server.js</code> (bukan <code>python -m http.server</code>) agar endpoint tulis aktif.';
    if (nav && nav.parentNode) nav.parentNode.insertBefore(banner, nav.nextSibling);
  }
  return ok;
}

/**
 * 9. API & Character Settings Handler
 */
function initSettingsValues() {
  const apiBaseInput = document.getElementById('settingApiBase');
  const apiKeyInput = document.getElementById('settingApiKey');
  const modelInput = document.getElementById('settingModel');

  if (apiBaseInput) apiBaseInput.value = llmClient.apiBase;
  if (apiKeyInput) apiKeyInput.value = llmClient.apiKey;
  if (modelInput) modelInput.value = llmClient.model;

  const editorSel = document.getElementById('settingEditor');
  if (editorSel) editorSel.value = getEditorPref();

  // Initialize Character & Per-Agent Model inputs
  initAgentSettingsValues();
}

function initAgentSettingsValues() {
  const keys = ['scrum_master', 'system_architect', 'backend_dev', 'frontend_dev', 'qa_engineer'];
  const savedSettings = loadSavedAgentSettings();

  keys.forEach(key => {
    const config = OFFICE_CONFIG.agents[key];
    const custom = savedSettings ? savedSettings[key] : null;

    const name = (custom && custom.name) ? custom.name : config.name;
    const fullName = (custom && custom.fullName) ? custom.fullName : `${name} (${config.role || config.tag})`;
    const model = (custom && custom.model) ? custom.model : '';

    const nameInput = document.getElementById(`charName_${key}`);
    const fullNameInput = document.getElementById(`charFullName_${key}`);
    const modelInput = document.getElementById(`charModel_${key}`);

    if (nameInput) {
      nameInput.value = name;
      nameInput.addEventListener('input', () => {
        const curName = nameInput.value.trim();
        if (fullNameInput && (!fullNameInput.value.trim() || fullNameInput.dataset.manualEdit !== 'true')) {
          fullNameInput.value = curName ? `${curName} (${config.role || config.tag})` : '';
        }
      });
    }
    if (fullNameInput) {
      fullNameInput.value = fullName;
      fullNameInput.addEventListener('input', () => {
        fullNameInput.dataset.manualEdit = 'true';
      });
    }
    if (modelInput) modelInput.value = model;

    // Update HUD Pill label
    const hudEl = document.getElementById(`hud_name_${key}`);
    if (hudEl) {
      hudEl.textContent = `${name} (${config.tag})`;
    }
  });

  updateChatFilterLabels();
}

function setAgentModelPreset(agentId, modelName) {
  const input = document.getElementById(`charModel_${agentId}`);
  if (input) {
    input.value = modelName;
    soundFx.playClick();
  }
}

function handleSaveAgentSettings() {
  const keys = ['scrum_master', 'system_architect', 'backend_dev', 'frontend_dev', 'qa_engineer', 'daisy'];
  const settings = {};

  keys.forEach(key => {
    const nameInput = document.getElementById(`charName_${key}`);
    const fullNameInput = document.getElementById(`charFullName_${key}`);
    const modelInput = document.getElementById(`charModel_${key}`);
    const config = OFFICE_CONFIG.agents[key];

    const name = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : config.name;
    let fullName = (fullNameInput && fullNameInput.value.trim()) ? fullNameInput.value.trim() : '';

    // If fullName is blank or was never manually customized, or still contains default old name while name changed:
    if (!fullName || (fullName.includes(config.name) && name !== config.name)) {
      fullName = `${name} (${config.role || config.tag})`;
      if (fullNameInput) fullNameInput.value = fullName;
    }

    const model = (modelInput && modelInput.value.trim()) ? modelInput.value.trim() : '';

    settings[key] = { name, fullName, model };

    // Update live config & characters instances
    OFFICE_CONFIG.agents[key].name = name;
    OFFICE_CONFIG.agents[key].fullName = fullName;
    if (characters[key]) {
      characters[key].name = name;
      characters[key].fullName = fullName;
    }
    if (typeof sprintManager !== 'undefined' && sprintManager.characters && sprintManager.characters[key]) {
      sprintManager.characters[key].name = name;
      sprintManager.characters[key].fullName = fullName;
    }

    // Update HUD Pill label
    const hudEl = document.getElementById(`hud_name_${key}`);
    if (hudEl) {
      hudEl.textContent = `${name} (${config.tag})`;
    }
  });

  try {
    localStorage.setItem('voffice_agent_settings', JSON.stringify(settings));
  } catch (e) {}

  // Update chat filter buttons text with customized names
  updateChatFilterLabels();

  // Re-render live chat so all chat bubbles immediately reflect the updated character names!
  renderChatLogUI();

  // Update deliverables dropdown & title in case agent name is displayed
  updateDeliverableContentDisplay();

  soundFx.playComplete();
  showToast('success', 'Pengaturan nama karakter & model AI berhasil disimpan!');
}

function toggleApiKeyVisibility() {
  const keyInput = document.getElementById('settingApiKey');
  if (keyInput) {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  }
}

function selectModelPreset(modelName) {
  const modelInput = document.getElementById('settingModel');
  if (modelInput) {
    modelInput.value = modelName;
    soundFx.playClick();
  }
}

function handleSaveApiSettings(e) {
  e.preventDefault();
  const apiBase = document.getElementById('settingApiBase').value;
  const apiKey = document.getElementById('settingApiKey').value;
  const model = document.getElementById('settingModel').value;

  llmClient.saveSettings(apiBase, apiKey, model);
  soundFx.playComplete();
  showToast('success', 'Pengaturan API berhasil disimpan!');
}

async function handleTestApiConnection() {
  const apiBase = document.getElementById('settingApiBase').value;
  const apiKey = document.getElementById('settingApiKey').value;
  const model = document.getElementById('settingModel').value;
  const btnTest = document.getElementById('btnTestApi');

  if (!apiKey.trim()) {
    showToast('error', 'Masukkan API Key terlebih dahulu untuk pengujian.');
    return;
  }

  btnTest.disabled = true;
  btnTest.textContent = 'Menguji...';

  try {
    const result = await llmClient.testConnection(apiBase, apiKey, model);
    soundFx.playComplete();
    showToast('success', `✓ API Terhubung! Respon: "${result}"`);
  } catch (err) {
    soundFx.playAlert();
    showToast('error', `Gagal terhubung: ${err.message}`);
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = '🔌 Test Koneksi';
  }
}

/**
 * 10. Toast Notification System
 */
function showToast(type = 'info', message = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✓', error: '⚠', info: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || '•'}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function formatChatText(str) {
  if (!str) return '';
  let text = escapeHtml(str);

  // Markdown Bold: **text** -> <strong>text</strong>
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Markdown Italic: *text* (avoid matching standalone asterisks)
  text = text.replace(/(^|[^\*])\*([^\*\n]+?)\*([^\*]|$)/g, '$1<em>$2</em>$3');

  // Inline code: `code`
  text = text.replace(/`([^`\n]+?)`/g, '<code class="chat-inline-code">$1</code>');

  // Blockquote: lines starting with &gt;
  text = text.replace(/^&gt;\s*(.+)$/gm, '<div class="chat-quote">$1</div>');

  return text;
}

/**
 * 2D Virtual Dev Office - 2.5D Isometric RPG Renderer & Depth Sorting Engine
 * Implements oblique/isometric projection, 3D relief furniture, volumetric glows, and strict Y-sorting.
 */

class OfficeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = OFFICE_CONFIG.canvas.width;
    this.height = OFFICE_CONFIG.canvas.height;

    // Display scaling: world px -> bitmap px, plus device pixel ratio for crisp text
    this.dpr = 1;
    this.viewScale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Crisp pixelated rendering
    this.ctx.imageSmoothingEnabled = false;

    // Animation & Particle Tickers
    this.frame = 0;
    this.particles = [];
    this.ledStates = [1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0];
    this.ledTimer = 0;
    this.bubbleTimer = 0;
    this.codeScrollOffset = 0;

    // Interactive 2.5D Camera & Room Zoom System
    this.camera = {
      x: this.width / 2,
      y: this.height / 2,
      zoom: 1.0,
      targetX: this.width / 2,
      targetY: this.height / 2,
      targetZoom: 1.0,
      followingAgent: null,
      activeRoom: null,
      lerpSpeed: 0.08
    };

    // Camera view presets for rooms (centered and scaled to show only that room)
    this.roomViews = {
      pantry: { name: 'Coffee Lounge & Pantry', x: 263, y: 175, zoom: 2.15, emoji: '☕' },
      war_room: { name: 'Scrum & Meeting Room', x: 737, y: 175, zoom: 2.15, emoji: '📊' },
      dev_cubicles: { name: 'Developer Cubicles', x: 263, y: 525, zoom: 2.15, emoji: '💻' },
      qa_server: { name: 'QA & Server Room', x: 737, y: 525, zoom: 2.15, emoji: '🛡️' },
      front_desk: { name: 'Front Desk & Reception', x: 500, y: 760, zoom: 2.15, emoji: '🛎️' }
    };

    // Initialize 2.5D Isometric Furniture Props
    this.initIsometricProps();
  }

  // =========================================================================
  // DISPLAY SIZING (device pixel ratio aware, keeps the 1000x860 world aspect)
  // =========================================================================
  resize() {
    const parent = this.canvas.parentElement;
    const availW = Math.max(320, (parent ? parent.clientWidth : this.width) - 20);
    const availH = Math.max(240, (parent ? parent.clientHeight : this.height) - 20);

    // Fit the world box inside the available space, preserving aspect ratio
    const fit = Math.min(availW / this.width, availH / this.height);
    const cssW = Math.round(this.width * fit);
    const cssH = Math.round(this.height * fit);

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    // Cap DPR (configurable). Pixel-art stays crisp because the canvas uses
    // image-rendering: pixelated, while a lower DPR sharply cuts fill-rate.
    const maxDpr = (OFFICE_CONFIG.canvas && OFFICE_CONFIG.canvas.maxDpr) || 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);

    this.viewScale = (cssW / this.width) * this.dpr;
    this.offsetX = 0;
    this.offsetY = 0;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  // Reset to bitmap space (identity transform)
  resetTransform() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // =========================================================================
  // CAMERA CONTROLS & COORDINATE TRANSFORMS
  // =========================================================================
  zoomToRoom(roomKey) {
    const view = this.roomViews[roomKey];
    if (!view) return;

    this.camera.followingAgent = null;
    this.camera.activeRoom = roomKey;
    this.camera.targetX = view.x;
    this.camera.targetY = view.y;
    this.camera.targetZoom = view.zoom;

    if (this.onCameraChanged) {
      this.onCameraChanged({
        mode: 'room',
        room: roomKey,
        name: view.name,
        emoji: view.emoji
      });
    }
  }

  followAgent(agent) {
    if (!agent) return;

    this.camera.activeRoom = null;
    this.camera.followingAgent = agent;
    this.camera.targetX = agent.x;
    this.camera.targetY = agent.y;
    this.camera.targetZoom = 2.35;

    if (this.onCameraChanged) {
      this.onCameraChanged({
        mode: 'follow',
        agent: agent,
        name: `${agent.emoji} ${agent.name} (${agent.role})`
      });
    }
  }

  resetCamera() {
    this.camera.followingAgent = null;
    this.camera.activeRoom = null;
    this.camera.targetX = this.width / 2;
    this.camera.targetY = this.height / 2;
    this.camera.targetZoom = 1.0;

    if (this.onCameraChanged) {
      this.onCameraChanged({
        mode: 'full',
        name: 'Full Office View'
      });
    }
  }

  isZoomed() {
    return this.camera.zoom > 1.05 || this.camera.followingAgent !== null || this.camera.activeRoom !== null;
  }

  screenToWorld(screenX, screenY) {
    // screenX/screenY arrive in bitmap pixels (see app.js mouse handler)
    const lx = screenX / this.viewScale;
    const ly = screenY / this.viewScale;
    return {
      x: (lx - this.width / 2) / this.camera.zoom + this.camera.x,
      y: (ly - this.height / 2) / this.camera.zoom + this.camera.y
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (worldY - this.camera.y) * this.camera.zoom + this.height / 2
    };
  }

  // World coordinates -> bitmap pixels, for the screen-space UI pass
  worldToBitmap(worldX, worldY) {
    const sx = (worldX - this.camera.x) * this.camera.zoom + this.width / 2;
    const sy = (worldY - this.camera.y) * this.camera.zoom + this.height / 2;
    return { x: sx * this.viewScale, y: sy * this.viewScale };
  }

  updateCamera() {
    if (this.camera.followingAgent) {
      this.camera.targetX = this.camera.followingAgent.x;
      this.camera.targetY = this.camera.followingAgent.y;
    }

    const lerp = this.camera.lerpSpeed;
    this.camera.x += (this.camera.targetX - this.camera.x) * lerp;
    this.camera.y += (this.camera.targetY - this.camera.y) * lerp;
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * lerp;

    if (Math.abs(this.camera.x - this.camera.targetX) < 0.05) this.camera.x = this.camera.targetX;
    if (Math.abs(this.camera.y - this.camera.targetY) < 0.05) this.camera.y = this.camera.targetY;
    if (Math.abs(this.camera.zoom - this.camera.targetZoom) < 0.005) this.camera.zoom = this.camera.targetZoom;
  }

  // =========================================================================
  // INITIALIZE 2.5D ISOMETRIC FURNITURE PROPS (With base anchorY for Z-ordering)
  // =========================================================================
  initIsometricProps() {
    this.props = [
      // --- PANTRY PROPS ---
      {
        id: 'pantry_counter',
        anchorY: 96,
        isTall: false,
        draw: (ctx) => this.drawIsoCoffeeCounter(ctx, 50, 52)
      },
      {
        id: 'pantry_fridge',
        anchorY: 88,
        isTall: true,
        bounds: { x1: 278, y1: 30, x2: 315, y2: 90 },
        draw: (ctx) => this.drawIsoRefrigerator(ctx, 280, 32)
      },
      {
        id: 'pantry_water',
        anchorY: 94,
        isTall: false,
        draw: (ctx) => this.drawIsoWaterDispenser(ctx, 330, 56)
      },
      {
        id: 'pantry_plant1',
        anchorY: 132,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 50, 110)
      },
      {
        id: 'pantry_sofa',
        anchorY: 150,
        isTall: false,
        draw: (ctx) => this.drawIsoFabricSofa(ctx, 203, 122)
      },
      {
        id: 'pantry_table',
        anchorY: 230,
        isTall: false,
        draw: (ctx) => this.drawIsoCoffeeTable(ctx, 223, 190)
      },
      {
        id: 'pantry_plant2',
        anchorY: 302,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 50, 280)
      },
      {
        id: 'pantry_plant3',
        anchorY: 72,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 400, 50)
      },

      // --- WAR ROOM PROPS ---
      {
        id: 'war_whiteboard',
        anchorY: 80,
        isTall: true,
        bounds: { x1: 616, y1: 28, x2: 884, y2: 84 },
        draw: (ctx) => this.drawIsoWhiteboard(ctx, 620, 32)
      },
      {
        id: 'war_projector',
        anchorY: 78,
        isTall: false,
        draw: (ctx) => this.drawIsoProjectorScreen(ctx, 900, 34)
      },
      {
        id: 'war_chair_top1',
        anchorY: 148,
        isTall: false,
        draw: (ctx) => this.drawIsoExecutiveChair(ctx, 676, 126, 'down')
      },
      {
        id: 'war_chair_top2',
        anchorY: 148,
        isTall: false,
        draw: (ctx) => this.drawIsoExecutiveChair(ctx, 766, 126, 'down')
      },
      {
        id: 'war_chair_head',
        anchorY: 198,
        isTall: false,
        draw: (ctx) => this.drawIsoExecutiveChair(ctx, 603, 187, 'right')
      },
      {
        id: 'war_board_table',
        anchorY: 242,
        isTall: false,
        draw: (ctx) => this.drawIsoBoardroomTable(ctx, 627, 150)
      },
      {
        id: 'war_chair_bot1',
        anchorY: 268,
        isTall: false,
        draw: (ctx) => this.drawIsoExecutiveChair(ctx, 676, 246, 'up')
      },
      {
        id: 'war_chair_bot2',
        anchorY: 268,
        isTall: false,
        draw: (ctx) => this.drawIsoExecutiveChair(ctx, 766, 246, 'up')
      },
      {
        id: 'war_chair_end',
        anchorY: 198,
        isTall: false,
        draw: (ctx) => this.drawIsoExecutiveChair(ctx, 851, 187, 'left')
      },
      {
        id: 'war_plant1',
        anchorY: 72,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 560, 50)
      },
      {
        id: 'war_plant2',
        anchorY: 292,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 940, 270)
      },

      // --- DEV CUBICLES PROPS ---
      {
        id: 'dev_bookshelf',
        anchorY: 404,
        isTall: false,
        draw: (ctx) => this.drawIsoBookshelf(ctx, 50, 388)
      },
      {
        id: 'dev_backend_desk',
        anchorY: 542,
        isTall: false,
        draw: (ctx) => this.drawIsoBackendDesk(ctx, 70, 470)
      },
      {
        id: 'dev_backend_chair',
        anchorY: 572,
        isTall: false,
        draw: (ctx) => this.drawIsoGamingChair(ctx, 110, 550, '#4f46e5', '#38bdf8')
      },
      {
        id: 'dev_cubicle_divider',
        anchorY: 546,
        isTall: false,
        draw: (ctx) => this.drawIsoCubicleDivider(ctx, 230, 448)
      },
      {
        id: 'dev_frontend_desk',
        anchorY: 542,
        isTall: false,
        draw: (ctx) => this.drawIsoFrontendDesk(ctx, 270, 470)
      },
      {
        id: 'dev_frontend_chair',
        anchorY: 572,
        isTall: false,
        draw: (ctx) => this.drawIsoGamingChair(ctx, 310, 550, '#0891b2', '#f97316')
      },

      // --- QA & SERVER ROOM PROPS ---
      {
        id: 'qa_server1',
        anchorY: 476,
        isTall: true,
        bounds: { x1: 836, y1: 400, x2: 936, y2: 480 },
        draw: (ctx) => this.drawIsoServerRack(ctx, 840, 405, 0)
      },
      {
        id: 'qa_server2',
        anchorY: 556,
        isTall: true,
        bounds: { x1: 836, y1: 480, x2: 936, y2: 560 },
        draw: (ctx) => this.drawIsoServerRack(ctx, 840, 485, 1)
      },
      {
        id: 'qa_server3',
        anchorY: 636,
        isTall: true,
        bounds: { x1: 836, y1: 560, x2: 936, y2: 640 },
        draw: (ctx) => this.drawIsoServerRack(ctx, 840, 565, 2)
      },
      {
        id: 'qa_workstation',
        anchorY: 542,
        isTall: false,
        draw: (ctx) => this.drawIsoQAWorkstation(ctx, 620, 470)
      },
      {
        id: 'qa_chair',
        anchorY: 572,
        isTall: false,
        draw: (ctx) => this.drawIsoGamingChair(ctx, 660, 550, '#e11d48', '#f43f5e')
      },

      // --- FRONT DESK & RECEPTION PROPS ---
      {
        id: 'reception_plant_l',
        anchorY: 710,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 40, 685)
      },
      {
        id: 'reception_plant_r',
        anchorY: 710,
        isTall: false,
        draw: (ctx) => this.drawIsoPlant(ctx, 940, 685)
      },
      {
        id: 'reception_chair',
        anchorY: 722,
        isTall: false,
        draw: (ctx) => this.drawIsoReceptionChair(ctx, 500, 715)
      },
      {
        id: 'reception_counter',
        anchorY: 765,
        isTall: false,
        bounds: { x1: 415, y1: 735, x2: 585, y2: 770 },
        draw: (ctx) => this.drawIsoReceptionCounter(ctx, 420, 735)
      },
      {
        id: 'reception_sofa_l',
        anchorY: 770,
        isTall: false,
        draw: (ctx) => this.drawIsoLobbySofa(ctx, 100, 740, 'right')
      },
      {
        id: 'reception_sofa_r',
        anchorY: 770,
        isTall: false,
        draw: (ctx) => this.drawIsoLobbySofa(ctx, 800, 740, 'left')
      }
    ];
  }

  // Add coffee steam particle
  addCoffeeSteam(x, y) {
    if (Math.random() < 0.4) {
      this.particles.push({
        type: 'steam',
        x: x + (Math.random() * 8 - 4),
        y: y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -0.6 - Math.random() * 0.5,
        alpha: 0.75,
        size: 2 + Math.random() * 2.5,
        maxLife: 45,
        life: 0
      });
    }
  }

  // Add coding spark particle
  addCodeParticle(x, y, color = '#38bdf8') {
    if (Math.random() < 0.3) {
      const chars = ['{ }', '</>', '01', 'SQL', 'PHP', 'JS', '⚡', '★', 'func()', '&&'];
      this.particles.push({
        type: 'code',
        text: chars[Math.floor(Math.random() * chars.length)],
        x: x + (Math.random() * 24 - 12),
        y: y - 10,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -0.8 - Math.random() * 0.6,
        alpha: 1.0,
        color: color,
        life: 0,
        maxLife: 42
      });
    }
  }

  // Add a floating "Zzz" sleep particle (SLEEPING standby pose)
  addZzzParticle(x, y) {
    this.particles.push({
      type: 'zzz',
      text: 'Z',
      x: x + (Math.random() * 8 - 4),
      y: y - 6,
      vx: 0.25 + Math.random() * 0.2,
      vy: -0.35 - Math.random() * 0.25,
      alpha: 1.0,
      size: 9 + Math.random() * 5,
      life: 0,
      maxLife: 70
    });
  }

  updateParticles() {
    this.frame++;
    this.codeScrollOffset = (this.codeScrollOffset + 0.3) % 20;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      p.alpha = 1 - (p.life / p.maxLife);

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }

    // Toggle server LEDs
    this.ledTimer++;
    if (this.ledTimer % 6 === 0) {
      for (let i = 0; i < this.ledStates.length; i++) {
        if (Math.random() < 0.35) {
          this.ledStates[i] = 1 - this.ledStates[i];
        }
      }
    }
    this.bubbleTimer++;
  }

  renderParticles() {
    for (const p of this.particles) {
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      if (p.type === 'steam') {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      } else if (p.type === 'code') {
        this.ctx.font = 'bold 9px monospace';
        this.ctx.fillStyle = p.color;
        this.ctx.shadowColor = p.color;
        this.ctx.shadowBlur = 6;
        this.ctx.fillText(p.text, p.x, p.y);
      } else if (p.type === 'zzz') {
        this.ctx.font = `bold ${Math.round(p.size)}px monospace`;
        this.ctx.fillStyle = '#c7d2fe';
        this.ctx.shadowColor = '#818cf8';
        this.ctx.shadowBlur = 6;
        this.ctx.fillText(p.text, p.x, p.y);
      }
      this.ctx.restore();
    }
  }

  // Clear canvas
  clear() {
    this.resetTransform();
    this.ctx.fillStyle = '#060911';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // =========================================================================
  // UNIFIED 2.5D ISOMETRIC RENDERING WITH STRICT Y-SORTING
  // =========================================================================
  render(charactersMap = null) {
    // 0. Update camera position & zoom lerp
    this.updateCamera();

    this.clear();

    // Begin Camera World Projection (world px -> bitmap px, then camera)
    this.ctx.save();
    this.ctx.setTransform(this.viewScale, 0, 0, this.viewScale, 0, 0);
    this.ctx.translate(this.width / 2, this.height / 2);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Render Isometric Ground Tiles & 3D Back Walls
    this.drawIsometricBaseAndWalls();

    // 2. Build Unified 2.5D Render Queue (Props + Characters)
    const renderQueue = [];

    // Add all isometric furniture props
    for (const prop of this.props) {
      renderQueue.push({
        type: 'prop',
        anchorY: prop.anchorY,
        item: prop
      });
    }

    // Add all active characters & check occlusion
    if (charactersMap) {
      for (const [key, agent] of Object.entries(charactersMap)) {
        // Occlusion check against tall objects (e.g. server racks, tall fridge)
        agent.isOccluded = false;
        for (const prop of this.props) {
          if (prop.isTall && prop.bounds) {
            const b = prop.bounds;
            if (agent.x >= b.x1 && agent.x <= b.x2 && agent.y >= b.y1 && agent.y <= b.y2) {
              agent.isOccluded = true;
              break;
            }
          }
        }

        renderQueue.push({
          type: 'character',
          anchorY: agent.anchorY,
          item: agent
        });
      }
    }

    // 3. Strict Y-Sorting (Z-ordering)
    // Smaller anchorY renders first (further back), larger anchorY renders later (in front)
    renderQueue.sort((a, b) => a.anchorY - b.anchorY);

    // 4. Draw Render Queue in Sorted Order
    for (const entry of renderQueue) {
      if (entry.type === 'prop') {
        entry.item.draw(this.ctx);
      } else if (entry.type === 'character') {
        // Seated agents (chair / desk / boardroom seat / lounge sofa) get the folded
        // seated pose: torso lowered into the seat, legs hidden, hands forward.
        entry.item.render(this.ctx, entry.item.isSeated());
      }
    }

    // 5. Update and render particle effects
    this.updateParticles();
    this.renderParticles();

    // 6. Volumetric Lighting & Screen Bloom Layer
    this.drawVolumetricGlows();

    // 7. Speech bubbles and labels are drawn in the screen-space pass below,
    //    so they keep a constant size and never collide with each other.
    this.ctx.restore();
    // End Camera World Projection

    // 8. Screen-space label pass: fixed pixel size, collision resolved
    this.drawScreenLabels(charactersMap);
  }

  // Full view gets only the two loudest bubbles; zoomed views get them all
  pickBubbleAgents(agents) {
    const speaking = agents.filter(a => a.speech && a.speech.text && a.speech.alpha > 0.05);
    if (this.camera.zoom >= 1.25) return new Set(speaking);
    return new Set(speaking.sort((a, b) => b.speech.alpha - a.speech.alpha).slice(0, 2));
  }

  // =========================================================================
  // ISOMETRIC GROUND TILES & 3D BACK WALLS
  // =========================================================================
  drawIsometricBaseAndWalls() {
    const ctx = this.ctx;

    // Outer Foundation
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(20, 20, 960, 828);

    // --- 1. ISOMETRIC FLOORS ---
    // Zone 1: Pantry (Warm Isometric Wood Parquet Diamonds)
    this.drawIsoParquetFloor(30, 30, 466, 300);

    // Zone 2: War Room (Executive Slate Diamond Weave Carpet)
    this.drawIsoSlateCarpet(504, 30, 466, 300);

    // Zone 3: Dev Cubicles (High-Tech Geometric Blue-Grey Grid)
    this.drawIsoDevTechFloor(30, 370, 466, 300);

    // Zone 4: QA Server Room (Metallic Perforated Floor with Hazard Stripes)
    this.drawIsoServerFloor(504, 370, 466, 300);

    // Central Agile Hub Runner & Compass (Crosswalk)
    this.drawIsoHallway(496, 30, 8, 640, 30, 330, 940, 40);

    // Zone 5: Front Desk & Reception (Luxury Polished Marble Lobby)
    this.drawIsoLobbyFloor(30, 676, 940, 168);

    // --- 2. 3D BACK WALLS (With depth, top cap thickness, and relief shading) ---
    this.draw3DBackAndSideWalls();
  }

  // Isometric Herringbone Wood Parquet
  drawIsoParquetFloor(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#451a03';
    ctx.fillRect(x, y, w, h);

    const step = 20;
    for (let py = y; py < y + h; py += step) {
      for (let px = x; px < x + w; px += step * 2) {
        const offset = ((py - y) / step) % 2 === 0 ? 0 : step;
        const tx = px + offset;
        if (tx + step * 2 > x + w + step) continue;

        // Draw diamond tile in 2:1 isometric proportion
        ctx.fillStyle = (Math.floor(tx / 30) + Math.floor(py / 20)) % 2 === 0 ? '#78350f' : '#92400e';
        ctx.beginPath();
        ctx.moveTo(tx, py + step / 2);
        ctx.lineTo(tx + step, py);
        ctx.lineTo(tx + step * 2, py + step / 2);
        ctx.lineTo(tx + step, py + step);
        ctx.closePath();
        ctx.fill();

        // 3D Plank bevel lines
        ctx.strokeStyle = 'rgba(60, 24, 3, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(254, 243, 199, 0.08)';
        ctx.fillRect(tx + 4, py + step / 2 - 2, step, 1);
      }
    }

    // Tilted Isometric Persian Rug (Centered in open lounge: center X=263, Y=210)
    const rx = 163, ry = 150, rw = 200, rh = 120;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(rx + 4, ry + 4, rw, rh);

    ctx.fillStyle = '#831843'; // Rose crimson
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx + 3, ry + 3, rw - 6, rh - 6);

    // Flanking Gold Diamond Medallions
    ctx.fillStyle = '#fef08a';
    const medallions = [
      { mx: rx + 30, my: ry + 60 },
      { mx: rx + rw - 30, my: ry + 60 }
    ];
    for (const med of medallions) {
      ctx.beginPath();
      ctx.moveTo(med.mx, med.my - 14); ctx.lineTo(med.mx + 14, med.my);
      ctx.lineTo(med.mx, med.my + 14); ctx.lineTo(med.mx - 14, med.my);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Isometric Slate Weave Carpet
  drawIsoSlateCarpet(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, w, h);

    const step = 24;
    for (let py = y; py < y + h; py += step) {
      for (let px = x; px < x + w; px += step * 2) {
        const offset = ((py - y) / step) % 2 === 0 ? 0 : step;
        const tx = px + offset;
        ctx.fillStyle = (Math.floor(tx / 24) + Math.floor(py / 24)) % 2 === 0 ? '#192334' : '#223044';
        ctx.beginPath();
        ctx.moveTo(tx, py + step / 2);
        ctx.lineTo(tx + step, py);
        ctx.lineTo(tx + step * 2, py + step / 2);
        ctx.lineTo(tx + step, py + step);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Boardroom Table Under-Carpet (Navy with Cyan Piping)
    // Symmetrically centered: Room center X=737, Table center X=737, Y=195 (35px equal padding around table)
    const tx = 592, ty = 115, tw = 290, th = 160;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(tx + 4, ty + 4, tw, th);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx + 1, ty + 1, tw - 2, th - 2);
  }

  // Isometric Geometric Tech Floor
  drawIsoDevTechFloor(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(x, y, w, h);

    const step = 28;
    for (let py = y; py < y + h; py += step) {
      for (let px = x; px < x + w; px += step * 2) {
        const offset = ((py - y) / step) % 2 === 0 ? 0 : step;
        const tx = px + offset;
        ctx.fillStyle = '#111929';
        ctx.beginPath();
        ctx.moveTo(tx, py + step / 2);
        ctx.lineTo(tx + step, py);
        ctx.lineTo(tx + step * 2, py + step / 2);
        ctx.lineTo(tx + step, py + step);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#060911';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(tx + step - 1, py + step / 2 - 1, 2, 2);
      }
    }
  }

  // Isometric Metallic Server Floor
  drawIsoServerFloor(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(x, y, w, h);

    const step = 26;
    for (let py = y; py < y + h; py += step) {
      for (let px = x; px < x + w; px += step * 2) {
        const offset = ((py - y) / step) % 2 === 0 ? 0 : step;
        const tx = px + offset;
        ctx.fillStyle = '#182030';
        ctx.beginPath();
        ctx.moveTo(tx, py + step / 2);
        ctx.lineTo(tx + step, py);
        ctx.lineTo(tx + step * 2, py + step / 2);
        ctx.lineTo(tx + step, py + step);
        ctx.closePath();
        ctx.fill();

        // 4 Raised ventilation dots in isometric diamond
        ctx.fillStyle = '#05070d';
        ctx.fillRect(tx + step - 4, py + step / 2 - 2, 2, 2);
        ctx.fillRect(tx + step + 2, py + step / 2 - 2, 2, 2);
      }
    }

    // Diagonal Yellow & Black Hazard Stripes
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(x + 10 + i * 25, y + h - 18, 12, 6);
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + 22 + i * 25, y + h - 18, 13, 6);
    }
  }

  // Isometric Hallway Runner & Walkway
  drawIsoHallway(hx, hy, hw, hh, wx, wy, ww, wh) {
    const ctx = this.ctx;
    ctx.fillStyle = '#141d2f';
    ctx.fillRect(hx, hy, hw, hh);
    ctx.fillRect(wx, wy, ww, wh);

    // Gilded Walkway Runner
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(wx, wy + 8, ww, wh - 16);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(wx, wy + 8, ww, 2);
    ctx.fillRect(wx, wy + wh - 10, ww, 2);
  }

  // Zone 5: Front Desk & Reception Floor (Polished Marble with Rose Runner)
  drawIsoLobbyFloor(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(x, y, w, h);

    const step = 24;
    for (let py = y; py < y + h; py += step) {
      for (let px = x; px < x + w; px += step * 2) {
        const offset = ((py - y) / step) % 2 === 0 ? 0 : step;
        const tx = px + offset;
        ctx.fillStyle = (Math.floor(tx / 24) + Math.floor(py / 24)) % 2 === 0 ? '#262220' : '#1c1917';
        ctx.beginPath();
        ctx.moveTo(tx, py + step / 2);
        ctx.lineTo(tx + step, py);
        ctx.lineTo(tx + step * 2, py + step / 2);
        ctx.lineTo(tx + step, py + step);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Plush Welcome Runner leading from entrance into the lobby desk (x: 440 to 560)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(442, y + 2, 116, 95);
    ctx.fillStyle = '#831843'; // Rose velvet
    ctx.fillRect(440, y, 120, 95);
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(442, y + 1, 116, 92);

    // Flanking Waiting Rugs (Left & Right)
    // Left lounge rug
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(82, 732, 136, 52);
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(80, 730, 136, 52);
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 1;
    ctx.strokeRect(82, 732, 132, 48);

    // Right lounge rug
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(782, 732, 136, 52);
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(780, 730, 136, 52);
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 1;
    ctx.strokeRect(782, 732, 132, 48);
  }

  // -------------------------------------------------------------------------
  // 3D BACK WALLS WITH RELIEF SHADING & LOW FOREGROUND THRESHOLDS
  // -------------------------------------------------------------------------
  draw3DBackAndSideWalls() {
    const ctx = this.ctx;

    // --- NORTH BACK WALLS (High with 3D Top Cap) ---
    // North Wall Body
    ctx.fillStyle = '#182234';
    ctx.fillRect(20, 20, 960, 16);
    // 3D Top Wall Cap (Shows depth/thickness viewed from above)
    ctx.fillStyle = '#334155';
    ctx.fillRect(20, 16, 960, 4);
    ctx.fillStyle = '#475569';
    ctx.fillRect(20, 16, 960, 1); // bright top rim
    // Drop shadow on floor below north wall
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(20, 36, 960, 4);

    // --- SIDE WALLS (West & East with Isometric Relief) ---
    // West Wall
    ctx.fillStyle = '#182234';
    ctx.fillRect(20, 20, 10, 824);
    ctx.fillStyle = '#334155';
    ctx.fillRect(16, 16, 4, 828);

    // East Wall
    ctx.fillStyle = '#182234';
    ctx.fillRect(970, 20, 10, 824);
    ctx.fillStyle = '#334155';
    ctx.fillRect(980, 16, 4, 828);

    // Central Dividing Walls (Between North & South rooms with open doorways)
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(20, 330, 385, 14); // Left wall section
    ctx.fillRect(470, 330, 26, 14); // Left corner post
    ctx.fillRect(504, 330, 26, 14); // Right corner post
    ctx.fillRect(595, 330, 375, 14); // Right wall section

    // 3D Top Cap for Horizontal Walls
    ctx.fillStyle = '#334155';
    ctx.fillRect(20, 328, 385, 2);
    ctx.fillRect(470, 328, 26, 2);
    ctx.fillRect(504, 328, 26, 2);
    ctx.fillRect(595, 328, 375, 2);

    // Ultra-Slim Vertical Dividing Wall (Single 8px wall with doorways and open central hallway)
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(496, 30, 8, 150);  // Top section
    ctx.fillRect(496, 260, 8, 68);  // Above hallway
    ctx.fillRect(496, 372, 8, 68);  // Below hallway
    ctx.fillRect(496, 520, 8, 116); // Bottom section (ends before lobby threshold)

    // 3D Top Cap / Rim for Vertical Wall
    ctx.fillStyle = '#334155';
    ctx.fillRect(496, 30, 2, 150);
    ctx.fillRect(496, 260, 2, 68);
    ctx.fillRect(496, 372, 2, 68);
    ctx.fillRect(496, 520, 2, 116);

    // Glass Sliding Doors & Walkway Thresholds
    // Top E-W Doorway (Pantry <-> Meeting)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.fillRect(498, 180, 4, 80);
    // Bottom E-W Doorway (Dev <-> QA)
    ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
    ctx.fillRect(498, 440, 4, 80);
    // Left N-S Doorway Threshold (Pantry <-> Dev)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.fillRect(405, 334, 65, 4);
    // Right N-S Doorway Threshold (Meeting <-> QA)
    ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.fillRect(530, 334, 65, 4);

    // --- DIVIDER BETWEEN DEV/QA AND FRONT DESK ---
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(20, 670, 410, 8);
    ctx.fillRect(570, 670, 410, 8);
    ctx.fillStyle = '#334155';
    ctx.fillRect(20, 668, 410, 2);
    ctx.fillRect(570, 668, 410, 2);
    // Threshold opening (Central Entrance into Front Desk Lobby)
    ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
    ctx.fillRect(430, 672, 140, 4);

    // --- SOUTH WALLS: LOBBY BOTTOM CUTAWAY THRESHOLD ---
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(20, 844, 960, 4); // Only 4px high baseboard
    ctx.fillStyle = '#334155';
    ctx.fillRect(20, 844, 960, 1);
  }

  // =========================================================================
  // ISOMETRIC 2.5D FURNITURE DRAWING ROUTINES
  // =========================================================================

  // 1. Isometric Marble Coffee Bar Counter
  drawIsoCoffeeCounter(ctx, x, y) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x + 4, y + 44, 224, 8);

    // Front/Side Wood Planks (South Face)
    ctx.fillStyle = '#27170a';
    ctx.fillRect(x, y + 8, 220, 36);
    ctx.fillStyle = '#451a03';
    for (let bx = x + 4; bx < x + 215; bx += 8) {
      ctx.fillRect(bx, y + 10, 5, 34);
    }

    // Marble Top Face (Tilted Isometric Slab with Bevel)
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x - 4, y, 228, 12);
    ctx.fillStyle = '#f8fafc'; // top specular sheen
    ctx.fillRect(x - 4, y, 228, 2);
    ctx.fillStyle = '#64748b'; // front bevel edge
    ctx.fillRect(x - 4, y + 10, 228, 2);

    // 2.5D Espresso Machine
    ctx.fillStyle = '#475569';
    ctx.fillRect(x + 20, y - 18, 46, 24);
    ctx.fillStyle = '#94a3b8'; // Chrome face
    ctx.fillRect(x + 22, y - 16, 42, 20);
    ctx.fillStyle = '#dc2626'; // Red accent
    ctx.fillRect(x + 24, y - 12, 38, 6);

    // Pressure Gauges & Portafilters
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x + 30, y - 4, 5, 5);
    ctx.fillRect(x + 45, y - 4, 5, 5);

    // Porcelain Mugs
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x + 30, y + 3, 6, 6);
    ctx.fillRect(x + 45, y + 3, 6, 6);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(x + 31, y + 4, 4, 2);
    ctx.fillRect(x + 46, y + 4, 4, 2);

    this.addCoffeeSteam(x + 33, y - 20);
    this.addCoffeeSteam(x + 48, y - 20);

    // Pastry Plate with Croissant & Donut
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(x + 118, y + 6, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d97706'; ctx.fillRect(x + 110, y + 3, 8, 5);
    ctx.fillStyle = '#ec4899'; ctx.fillRect(x + 120, y + 2, 7, 6);
  }

  // 2. 3D Retro Mint Refrigerator
  drawIsoRefrigerator(ctx, x, y) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + 4, y + 54, 34, 6);

    // 3D Cabinet Side (Shaded Face)
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(x + 26, y + 2, 8, 52);

    // Front Door Face
    ctx.fillStyle = '#14b8a6';
    ctx.fillRect(x, y + 2, 26, 52);

    // Top Face (3D Roof)
    ctx.fillStyle = '#2dd4bf';
    ctx.fillRect(x, y, 26, 3);

    // Freezer door split & chrome handles
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(x, y + 18, 26, 2);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x + 4, y + 8, 2, 6);
    ctx.fillRect(x + 4, y + 24, 2, 9);

    // Magnets
    ctx.fillStyle = '#fef08a'; ctx.fillRect(x + 10, y + 6, 5, 5);
    ctx.fillStyle = '#f43f5e'; ctx.fillRect(x + 18, y + 10, 4, 4);
    ctx.fillStyle = '#38bdf8'; ctx.fillRect(x + 12, y + 26, 6, 6);
  }

  // 3. 2.5D Water Dispenser
  drawIsoWaterDispenser(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x + 4, y + 36, 26, 5);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x, y + 8, 26, 30);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x, y + 22, 26, 2);

    ctx.fillStyle = '#ef4444'; ctx.fillRect(x + 5, y + 18, 3, 3);
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(x + 16, y + 18, 3, 3);

    // 3D Inverted Blue Bottle
    ctx.fillStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.fillRect(x + 3, y - 16, 20, 24);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(x + 5, y - 14, 3, 20);

    const bubbleY = y + 4 - (this.bubbleTimer % 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 12, bubbleY, 2, 2);
  }

  // 4. 2.5D Tufted Leather Sofa
  drawIsoFabricSofa(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + 6, y + 26, 116, 8);

    // Sofa Base
    ctx.fillStyle = '#5c1d0c';
    ctx.fillRect(x, y, 120, 28);
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(x + 2, y + 2, 116, 24);

    // 3 Cushions
    for (let c = 0; c < 3; c++) {
      const cx = x + 6 + c * 38;
      ctx.fillStyle = '#c2410c';
      ctx.fillRect(cx, y + 4, 34, 18);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(cx + 2, y + 5, 30, 3);
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(cx + 16, y + 12, 2, 2); // tufted button
    }
    // Armrests
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(x - 2, y, 6, 28);
    ctx.fillRect(x + 116, y, 6, 28);
  }

  // 5. 2.5D Low Coffee Table
  drawIsoCoffeeTable(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + 4, y + 36, 76, 8);

    ctx.fillStyle = '#361502';
    ctx.fillRect(x, y, 80, 40);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(x + 2, y + 2, 76, 36);
    ctx.fillStyle = 'rgba(254, 243, 199, 0.15)';
    ctx.fillRect(x + 4, y + 4, 72, 4);

    // Magazine & steaming coffee
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(x + 15, y + 12, 18, 20);
    ctx.fillStyle = '#38bdf8'; ctx.fillRect(x + 18, y + 15, 12, 5);
    ctx.fillStyle = '#dc2626'; ctx.fillRect(x + 50, y + 16, 8, 8);
    this.addCoffeeSteam(x + 54, y + 12);
  }

  // 6. 2.5D Terracotta Plant
  drawIsoPlant(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 22, 12, 5, -Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#c2410c';
    ctx.fillRect(x, y + 10, 16, 12);
    ctx.fillStyle = '#ea580c';
    ctx.fillRect(x - 2, y + 8, 20, 4);

    ctx.fillStyle = '#14532d';
    ctx.beginPath(); ctx.arc(x + 8, y + 4, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#15803d';
    ctx.beginPath(); ctx.arc(x + 7, y + 3, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.arc(x + 3, y + 1, 5, 0, Math.PI * 2); ctx.fill();
  }

  // 7. 2.5D Isometric Mounted Whiteboard
  drawIsoWhiteboard(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + 4, y + 46, 256, 6);

    ctx.fillStyle = '#64748b';
    ctx.fillRect(x - 2, y - 2, 264, 50);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x, y, 260, 46);

    // Columns: TODO | WIP | DONE
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 86, y + 2); ctx.lineTo(x + 86, y + 44);
    ctx.moveTo(x + 172, y + 2); ctx.lineTo(x + 172, y + 44);
    ctx.stroke();

    // Column captions only when they are actually legible
    if (this.camera.zoom >= 1.3) {
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('TODO', x + 15, y + 10);
      ctx.fillText('WIP', x + 115, y + 10);
      ctx.fillText('DONE ✓', x + 185, y + 10);
    }

    // Sticky Notes
    ctx.fillStyle = '#fef08a'; ctx.fillRect(x + 96, y + 16, 12, 10);
    ctx.fillStyle = '#f472b6'; ctx.fillRect(x + 114, y + 20, 12, 10);
    ctx.fillStyle = '#67e8f9'; ctx.fillRect(x + 132, y + 16, 12, 10);

    ctx.fillStyle = '#86efac'; ctx.fillRect(x + 184, y + 16, 12, 10);
    ctx.fillStyle = '#86efac'; ctx.fillRect(x + 202, y + 22, 12, 10);
  }

  // 8. 2.5D Burndown Velocity Screen
  drawIsoProjectorScreen(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x + 2, y + 44, 58, 4);

    ctx.fillStyle = '#020617';
    ctx.fillRect(x, y, 60, 44);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, 60, 44);

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 10); ctx.lineTo(x + 18, y + 18);
    ctx.lineTo(x + 32, y + 12); ctx.lineTo(x + 54, y + 36);
    ctx.stroke();

    if (this.camera.zoom >= 1.3) {
      ctx.fillStyle = '#38bdf8'; ctx.font = '6px monospace';
      ctx.fillText('BURNDOWN', x + 4, y + 8);
    }
  }

  // 9. 2.5D Long Diagonal Boardroom Table
  drawIsoBoardroomTable(ctx, x, y) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x + 6, y + 88, 214, 12);

    // 4 Sturdy 3D Carved Table Legs
    ctx.fillStyle = '#1e0c04';
    ctx.fillRect(x + 10, y + 70, 8, 20);
    ctx.fillRect(x + 200, y + 70, 8, 20);
    ctx.fillRect(x + 10, y + 10, 8, 20);
    ctx.fillRect(x + 200, y + 10, 8, 20);

    // Beveled Dark Oak Wood Table
    ctx.fillStyle = '#2e1507';
    ctx.fillRect(x, y, 220, 90);
    ctx.fillStyle = '#451a03';
    ctx.fillRect(x + 2, y + 2, 216, 86);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(x + 4, y + 4, 212, 82);

    // Brass Inlay Border
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 12, y + 12, 196, 66);

    // Glass Inlay Runner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.fillRect(x + 20, y + 18, 180, 54);

    // Laptops open on table
    this.drawIsoLaptop(x + 40, y + 22, '#38bdf8');
    this.drawIsoLaptop(x + 160, y + 22, '#a855f7');

    // Water carafe
    ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.fillRect(x + 104, y + 32, 12, 16);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 106, y + 34, 3, 12);
  }

  // 10. 2.5D Executive Swivel Chair
  drawIsoExecutiveChair(ctx, x, y, facing) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 14, 11, 6, -Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 12, y + 12, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x + 4, y + 4, 16, 16);

    ctx.fillStyle = '#0f172a';
    if (facing === 'up') {
      ctx.fillRect(x + 2, y + 18, 20, 5);
    } else if (facing === 'down') {
      ctx.fillRect(x + 2, y + 1, 20, 5);
    } else if (facing === 'left') {
      ctx.fillRect(x + 18, y + 2, 5, 20);
    } else {
      ctx.fillRect(x + 1, y + 2, 5, 20);
    }
  }

  // 11. 2.5D Backend Dev Desk
  drawIsoBackendDesk(ctx, x, y) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x + 6, y + 68, 136, 10);

    // Desk Base & Legs
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(x, y, 140, 70);
    ctx.fillStyle = '#312e81';
    ctx.fillRect(x + 2, y + 2, 136, 66);
    ctx.fillStyle = '#4338ca';
    ctx.fillRect(x + 4, y + 4, 132, 4);

    // Dual Monitors (Tilted diagonally facing chair)
    this.drawGlowingMonitor(x + 15, y + 8, 44, 28, '#060913', 'backend');
    this.drawVerticalTerminal(x + 64, y + 4, 24, 36);

    // Mechanical RGB Keyboard
    const rgbColors = ['#f43f5e', '#a855f7', '#38bdf8', '#22c55e'];
    const curRgb = rgbColors[Math.floor(this.frame / 18) % rgbColors.length];
    ctx.fillStyle = curRgb;
    ctx.fillRect(x + 24, y + 44, 40, 14);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + 26, y + 46, 36, 10);

    // Mouse & Pad
    ctx.fillStyle = '#334155'; ctx.fillRect(x + 68, y + 46, 12, 12);
    ctx.fillStyle = '#6366f1'; ctx.fillRect(x + 72, y + 50, 4, 6);

    // Rubber Duck
    ctx.fillStyle = '#facc15'; ctx.fillRect(x + 6, y + 20, 8, 8);
    ctx.fillStyle = '#f97316'; ctx.fillRect(x + 12, y + 22, 4, 3);

    // Coffee Tumbler
    ctx.fillStyle = '#475569'; ctx.fillRect(x + 6, y + 44, 6, 11);

    // PC Tower under desk with glowing intake fan
    ctx.fillStyle = '#090d16'; ctx.fillRect(x + 112, y + 12, 22, 44);
    ctx.strokeStyle = '#334155'; ctx.strokeRect(x + 112, y + 12, 22, 44);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(x + 123, y + 34, 6, 0, Math.PI * 2); ctx.fill();
  }

  // 12. 2.5D Frontend Dev Desk
  drawIsoFrontendDesk(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x + 6, y + 68, 136, 10);

    ctx.fillStyle = '#083344';
    ctx.fillRect(x, y, 140, 70);
    ctx.fillStyle = '#0e7490';
    ctx.fillRect(x + 2, y + 2, 136, 66);
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(x + 4, y + 4, 132, 4);

    // Dual Monitors
    this.drawGlowingMonitor(x + 14, y + 8, 44, 28, '#18181b', 'frontend_ui');
    this.drawGlowingMonitor(x + 64, y + 8, 44, 28, '#ffffff', 'frontend_browser');

    // Drawing Tablet with Stylus
    ctx.fillStyle = '#0f172a'; ctx.fillRect(x + 14, y + 44, 26, 16);
    ctx.fillStyle = '#06b6d4'; ctx.fillRect(x + 16, y + 46, 20, 12);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 38, y + 48, 2, 8);

    // Keyboard & Mouse
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(x + 45, y + 46, 34, 12);
    ctx.fillStyle = '#06b6d4'; ctx.fillRect(x + 84, y + 48, 8, 8);

    // Succulent Plant
    ctx.fillStyle = '#ea580c'; ctx.fillRect(x + 114, y + 14, 9, 9);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(x + 115, y + 9, 7, 5);
  }

  // 13. 2.5D High-Back Gaming Chair
  drawIsoGamingChair(ctx, x, y, primaryColor, stripeColor) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 14, 12, 6, -Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 12, y + 12, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = primaryColor;
    ctx.fillRect(x + 3, y + 4, 18, 16);
    ctx.fillStyle = stripeColor;
    ctx.fillRect(x + 10, y + 4, 4, 16);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + 1, y + 18, 22, 6);
    ctx.fillStyle = stripeColor;
    ctx.fillRect(x + 8, y + 19, 8, 4);
  }

  drawIsoCubicleDivider(ctx, x, y) {
    ctx.fillStyle = '#334155'; ctx.fillRect(x, y, 10, 94);
    ctx.fillStyle = '#fef08a'; ctx.fillRect(x + 1, y + 12, 4, 6);
    ctx.fillStyle = '#67e8f9'; ctx.fillRect(x + 1, y + 32, 4, 6);
    ctx.fillStyle = '#f43f5e'; ctx.fillRect(x + 1, y + 52, 4, 6);
  }

  drawIsoBookshelf(ctx, x, y) {
    ctx.fillStyle = '#78350f'; ctx.fillRect(x, y, 100, 14);
    const bookColors = ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#06b6d4'];
    for (let b = 0; b < bookColors.length; b++) {
      ctx.fillStyle = bookColors[b];
      ctx.fillRect(x + 5 + b * 15, y - 14, 10, 14);
    }
  }

  // 14. Tall 3D Isometric Server Towers (Racks)
  drawIsoServerRack(ctx, x, y, rackIndex) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x + 4, y + 66, 92, 8);

    // 3D Cabinet Roof / Top Face
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, 92, 4);

    // Cabinet Main Frame
    ctx.fillStyle = '#090d16';
    ctx.fillRect(x, y + 4, 92, 64);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y + 4, 92, 64);

    // 4 Stacked Server Blades
    for (let slot = 0; slot < 4; slot++) {
      const sy = y + 8 + slot * 14;
      ctx.fillStyle = '#141d2e';
      ctx.fillRect(x + 4, sy, 84, 12);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x + 4, sy, 84, 1);

      // Caddies
      ctx.fillStyle = '#334155';
      ctx.fillRect(x + 8, sy + 3, 20, 6);
      ctx.fillRect(x + 32, sy + 3, 20, 6);

      // Blinking LEDs
      const ledBase = (rackIndex * 4 + slot * 2) % this.ledStates.length;
      const isGreen = this.ledStates[ledBase];
      const isBlue = this.ledStates[(ledBase + 1) % this.ledStates.length];
      const isRed = this.ledStates[(ledBase + 2) % this.ledStates.length];

      ctx.fillStyle = isGreen ? '#22c55e' : '#14532d';
      ctx.fillRect(x + 60, sy + 4, 4, 3);
      ctx.fillStyle = isBlue ? '#38bdf8' : '#0369a1';
      ctx.fillRect(x + 67, sy + 4, 4, 3);
      ctx.fillStyle = isRed ? '#f43f5e' : '#881337';
      ctx.fillRect(x + 74, sy + 4, 4, 3);
    }
  }

  // 15. 2.5D QA Workstation & Security Radar
  drawIsoQAWorkstation(ctx, x, y) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x + 6, y + 68, 146, 10);

    ctx.fillStyle = '#18181b';
    ctx.fillRect(x, y, 150, 70);
    ctx.fillStyle = '#27272a';
    ctx.fillRect(x + 2, y + 2, 146, 66);
    ctx.fillStyle = '#3f3f46';
    ctx.fillRect(x + 4, y + 4, 142, 4);

    // Left Monitor: Vulnerability Radar Sweep
    this.drawGlowingMonitor(x + 14, y + 8, 44, 28, '#022c22', 'qa_radar');
    // Right Monitor: Attack Vector Metrics
    this.drawGlowingMonitor(x + 64, y + 8, 44, 28, '#18181b', 'qa_metrics');

    // Clipboard & Badge
    ctx.fillStyle = '#78350f'; ctx.fillRect(x + 114, y + 14, 18, 24);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(x + 116, y + 16, 14, 20);
    ctx.fillStyle = '#dc2626'; ctx.fillRect(x + 118, y + 20, 10, 2);
    ctx.fillStyle = '#16a34a'; ctx.fillRect(x + 118, y + 24, 10, 2);

    ctx.fillStyle = '#3f3f46'; ctx.fillRect(x + 35, y + 46, 40, 12);
    ctx.fillStyle = '#f43f5e'; ctx.fillRect(x + 82, y + 48, 8, 8);
  }

  // -------------------------------------------------------------------------
  // GLOWING COMPUTER MONITORS (Animated scrolling syntax code)
  // -------------------------------------------------------------------------
  drawGlowingMonitor(x, y, w, h, bg, type) {
    const ctx = this.ctx;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = bg;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

    if (type === 'backend') {
      const codeColors = ['#6366f1', '#22c55e', '#f59e0b', '#38bdf8', '#e2e8f0'];
      for (let i = 0; i < 5; i++) {
        const lineY = y + 5 + i * 4;
        ctx.fillStyle = codeColors[(i + Math.floor(this.codeScrollOffset / 4)) % codeColors.length];
        ctx.fillRect(x + 5, lineY, 14 + (i % 3) * 8, 2);
      }
    } else if (type === 'frontend_ui') {
      ctx.fillStyle = '#ec4899'; ctx.fillRect(x + 5, y + 5, 12, 6);
      ctx.fillStyle = '#06b6d4'; ctx.fillRect(x + 20, y + 5, 18, 6);
      ctx.fillStyle = '#334155'; ctx.fillRect(x + 5, y + 14, 32, 8);
    } else if (type === 'frontend_browser') {
      ctx.fillStyle = '#0284c7'; ctx.fillRect(x + 2, y + 2, w - 4, 4);
      ctx.fillStyle = '#94a3b8'; ctx.fillRect(x + 5, y + 9, 14, 12);
      ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x + 22, y + 9, 14, 12);
    } else if (type === 'qa_radar') {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 7, 0, Math.PI * 2);
      ctx.stroke();
      const sweepAngle = (this.frame * 0.08) % (Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + h / 2);
      ctx.lineTo(x + w / 2 + Math.cos(sweepAngle) * 7, y + h / 2 + Math.sin(sweepAngle) * 7);
      ctx.stroke();
    } else if (type === 'qa_metrics') {
      ctx.fillStyle = '#f43f5e'; ctx.fillRect(x + 5, y + 5, 6, 4);
      ctx.fillStyle = '#22c55e'; ctx.fillRect(x + 14, y + 5, 22, 4);
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(x + 5, y + 12, 30, 3);
      ctx.fillStyle = '#eab308'; ctx.fillRect(x + 5, y + 18, 20, 3);
    }

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x + w / 2 - 3, y + h, 6, 4);
  }

  drawVerticalTerminal(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#022c22';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

    ctx.fillStyle = '#4ade80';
    for (let i = 0; i < 7; i++) {
      const ly = y + 5 + i * 4;
      ctx.fillRect(x + 4, ly, 10 + (i % 3) * 4, 2);
    }
  }

  drawIsoLaptop(x, y, screenColor) {
    const ctx = this.ctx;
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, y, 20, 15);
    ctx.fillStyle = screenColor;
    ctx.fillRect(x + 2, y + 2, 16, 11);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(x - 2, y + 14, 24, 3);
  }

  // -------------------------------------------------------------------------
  // FRONT DESK & RECEPTION FURNITURE
  // -------------------------------------------------------------------------
  drawIsoReceptionCounter(ctx, x, y) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + 4, y + 26, 156, 8);

    // Front Counter Facade (Polished Dark Walnut & Brushed Brass Band)
    ctx.fillStyle = '#1e1b18';
    ctx.fillRect(x, y + 8, 160, 20);
    // Vertical fluted wood slats
    ctx.fillStyle = '#292524';
    for (let bx = x + 4; bx < x + 155; bx += 8) {
      ctx.fillRect(bx, y + 9, 4, 18);
    }
    // Brushed Brass Trim
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x, y + 26, 160, 2);

    // Polished Quartz Countertop (Tilted Isometric Slab with Specular Highlight)
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x - 4, y, 168, 9);
    ctx.fillStyle = '#ffffff'; // Top highlight
    ctx.fillRect(x - 4, y, 168, 2);
    ctx.fillStyle = '#94a3b8'; // Bevel edge
    ctx.fillRect(x - 4, y + 7, 168, 2);

    // Front Desk Bell (🛎️ Brass Bell)
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x + 20, y - 4, 8, 5);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(x + 23, y - 6, 2, 2);

    // Vase with Yellow Daisy Blossoms
    ctx.fillStyle = '#0284c7'; // Glass vase
    ctx.fillRect(x + 135, y - 6, 8, 8);
    ctx.fillStyle = '#22c55e'; // Stems
    ctx.fillRect(x + 138, y - 10, 2, 4);
    // Daisies
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 134, y - 13, 4, 4);
    ctx.fillRect(x + 139, y - 12, 4, 4);
    ctx.fillStyle = '#f59e0b'; // Flower centers
    ctx.fillRect(x + 135, y - 12, 2, 2);
    ctx.fillRect(x + 140, y - 11, 2, 2);

    // Guest Logbook & Pen
    ctx.fillStyle = '#334155';
    ctx.fillRect(x + 40, y + 1, 14, 6);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x + 42, y + 2, 10, 4);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x + 56, y + 2, 2, 5);

    // Daisy's Front Desk Laptop
    this.drawIsoLaptop(x + 72, y - 5, '#ec4899');
  }

  drawIsoReceptionChair(ctx, x, y) {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x - 8, y + 6, 16, 6);

    // Ergonomic pastel rose chair
    ctx.fillStyle = '#be185d';
    ctx.fillRect(x - 7, y - 10, 14, 12);
    ctx.fillStyle = '#f472b6'; // Cushion
    ctx.fillRect(x - 6, y - 9, 12, 10);
    ctx.fillStyle = '#334155'; // Swivel base
    ctx.fillRect(x - 2, y + 2, 4, 6);
    ctx.fillRect(x - 6, y + 6, 12, 2);
  }

  drawIsoLobbySofa(ctx, x, y, dir = 'right') {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x + 2, y + 22, 100, 8);

    // Sofa Base
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(x, y + 6, 100, 18);
    // Backrest
    ctx.fillStyle = '#312e81';
    ctx.fillRect(x, y, 100, 8);
    ctx.fillStyle = '#4338ca';
    ctx.fillRect(x + 2, y + 1, 96, 6);

    // Seat Cushions (3 cushions)
    const cushionW = 30;
    for (let i = 0; i < 3; i++) {
      const cx = x + 4 + i * 31;
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(cx, y + 8, cushionW, 14);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(cx + 2, y + 9, cushionW - 4, 3);
    }

    // Armrests
    ctx.fillStyle = '#312e81';
    ctx.fillRect(x - 2, y + 4, 5, 18);
    ctx.fillRect(x + 97, y + 4, 5, 18);
  }

  // -------------------------------------------------------------------------
  // VOLUMETRIC LIGHTING & SCREEN BLOOM
  // -------------------------------------------------------------------------
  drawVolumetricGlows() {
    const ctx = this.ctx;

    // Gradients are built ONCE and reused (they live in world coordinates, so
    // they do not change with canvas size) — this removes 4 allocations/frame.
    if (!this._glowLayers) {
      const makeGlow = (cx, cy, r, stops) => {
        const g = ctx.createRadialGradient(cx, cy, Math.max(1, r * 0.07), cx, cy, r);
        stops.forEach(([off, color]) => g.addColorStop(off, color));
        return { grad: g, cx, cy, r };
      };
      this._glowLayers = [
        // Warm glow over coffee machine
        makeGlow(90, 45, 70, [[0, 'rgba(251, 191, 36, 0.25)'], [1, 'rgba(251, 191, 36, 0)']]),
        // Cyan glow over Backend Dev monitors
        makeGlow(110, 495, 65, [[0, 'rgba(56, 189, 248, 0.28)'], [1, 'rgba(56, 189, 248, 0)']]),
        // Teal glow over Frontend Dev monitors
        makeGlow(310, 495, 65, [[0, 'rgba(6, 182, 212, 0.28)'], [1, 'rgba(6, 182, 212, 0)']]),
        // Server LED glowing blooms
        makeGlow(880, 520, 115, [[0, 'rgba(34, 197, 94, 0.18)'], [0.5, 'rgba(56, 189, 248, 0.12)'], [1, 'rgba(0, 0, 0, 0)']])
      ];
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const layer of this._glowLayers) {
      ctx.fillStyle = layer.grad;
      ctx.beginPath();
      ctx.arc(layer.cx, layer.cy, layer.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Screen-Space Labels: room chips + agent nameplates at fixed pixel sizes.
  // Drawn after the camera transform is popped, so text never scales with zoom.
  drawScreenLabels(charactersMap = null) {
    const ctx = this.ctx;
    const placed = [];

    const collides = (r) => placed.some(p => !(r.x2 < p.x1 || r.x1 > p.x2 || r.y2 < p.y1 || r.y1 > p.y2));

    // 1. Speech bubbles: fixed size, clamped inside the canvas, never scaled by zoom
    if (charactersMap) {
      this.drawScreenBubbles(Object.values(charactersMap), placed);
    }

    // 2. Room chips. Useful at full view, redundant once a room fills the screen.
    if (this.camera.zoom < 1.35) {
      const rooms = [
        { text: '☕ Coffee Lounge & Pantry', x: 40, y: 22, color: '#f59e0b' },
        { text: '📊 Scrum & Meeting Room', x: 520, y: 22, color: '#10b981' },
        { text: '💻 Developer Cubicles', x: 40, y: 362, color: '#38bdf8' },
        { text: '🛡️ QA & Server Room', x: 520, y: 362, color: '#f43f5e' },
        { text: '🛎️ Front Desk & Reception', x: 380, y: 686, color: '#f472b6' }
      ];

      for (const room of rooms) {
        const at = this.worldToBitmap(room.x, room.y);
        this.drawScreenChip(ctx, room.text, at.x, at.y, room.color, null, 'left', placed, collides);
      }
    }

    // 3. Agent nameplates. Front-most agents claim space first.
    //    At full view only non-idle agents get a label: the HUD bar already
    //    lists everyone, so idle nameplates would just add noise.
    if (charactersMap) {
      const stateColors = {
        'IDLE': '#94a3b8',
        'WALKING': '#38bdf8',
        'MEETING': '#f59e0b',
        'CODING': '#22c55e',
        'REVIEWING': '#f43f5e',
        'DRINKING': '#38bdf8',
        'EATING': '#f59e0b',
        'SITTING': '#a78bfa',
        'SLEEPING': '#818cf8'
      };

      // Standby poses are relaxed idling: keep them label-quiet at full view
      const quietStates = ['IDLE', 'DRINKING', 'EATING', 'SITTING', 'SLEEPING'];

      const fullView = this.camera.zoom < 1.35;
      const agents = Object.values(charactersMap)
        .filter(a => !fullView || !quietStates.includes(a.state) || this.camera.followingAgent === a)
        .sort((a, b) => a.y - b.y);

      for (const agent of agents) {
        const at = this.worldToBitmap(agent.x, agent.y - 46);
        this.drawScreenChip(
          ctx,
          `${agent.emoji} ${agent.name}`,
          at.x,
          at.y,
          agent.color,
          stateColors[agent.state] || '#94a3b8',
          'center',
          placed,
          collides
        );
      }
    }
  }

  // One label chip. Nudges vertically to dodge earlier chips, gives up if boxed in.
  drawScreenChip(ctx, text, anchorX, anchorY, borderColor, dotColor, align, placed, collides) {
    // Off-screen anchors would otherwise pile up against the canvas edge
    if (anchorX < 0 || anchorX > this.canvas.width || anchorY < 0 || anchorY > this.canvas.height) return;

    const dpr = this.dpr;
    const fontPx = Math.round(11 * dpr);
    const padX = Math.round(8 * dpr);
    const padY = Math.round(4 * dpr);
    const chipH = Math.round(20 * dpr);
    const nudge = Math.round(23 * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `600 ${fontPx}px Inter, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const dotW = dotColor ? Math.round(12 * dpr) : 0;
    const textW = ctx.measureText(text).width;
    const chipW = Math.round(textW + padX * 2 + dotW);

    let x = align === 'center' ? anchorX - chipW / 2 : anchorX;
    x = Math.max(Math.round(4 * dpr), Math.min(x, this.canvas.width - chipW - Math.round(4 * dpr)));

    // Try the anchor line, then nudge up, then down. Skip if every slot is taken.
    const offsets = [0, -nudge, -nudge * 2, -nudge * 3, nudge, nudge * 2, nudge * 3];
    let y = null;
    for (const off of offsets) {
      const candidate = Math.round(anchorY - chipH / 2 + off);
      const top = Math.max(Math.round(4 * dpr), Math.min(candidate, this.canvas.height - chipH - Math.round(4 * dpr)));
      const box = { x1: x, y1: top, x2: x + chipW, y2: top + chipH };
      if (!collides(box)) {
        y = top;
        placed.push(box);
        break;
      }
    }
    if (y === null) return;

    const r = Math.round(5 * dpr);
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, chipW, chipH, r);
    } else {
      ctx.rect(x, y, chipW, chipH);
    }
    ctx.fillStyle = 'rgba(9, 14, 26, 0.92)';
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.stroke();

    if (dotColor) {
      ctx.beginPath();
      ctx.arc(x + padX + Math.round(2 * dpr), y + chipH / 2, Math.round(3 * dpr), 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }

    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(text, x + padX + dotW, y + chipH / 2 + Math.round(dpr * 0.5));
  }

  // Speech bubbles in screen space: constant size at any zoom, clamped to the canvas.
  drawScreenBubbles(agents, placed) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const speaking = this.pickBubbleAgents(agents);
    if (!speaking.size) return;

    const fontPx = Math.round(11 * dpr);
    const lineH = Math.round(15 * dpr);
    const padX = Math.round(10 * dpr);
    const padY = Math.round(8 * dpr);
    const maxTextW = Math.round(190 * dpr);
    const margin = Math.round(4 * dpr);

    for (const agent of speaking) {
      const speech = agent.speech;
      if (!speech || !speech.text) continue;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `500 ${fontPx}px Inter, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const lines = this.wrapText(ctx, speech.text, maxTextW);
      let textW = 0;
      for (const line of lines) textW = Math.max(textW, ctx.measureText(line).width);

      const w = Math.round(textW + padX * 2);
      const h = Math.round(lines.length * lineH + padY * 2);

      const anchor = this.worldToBitmap(agent.x, agent.y - 46);
      if (anchor.x < 0 || anchor.x > this.canvas.width || anchor.y < 0 || anchor.y > this.canvas.height) continue;

      const x = Math.max(margin, Math.min(Math.round(anchor.x - w / 2), this.canvas.width - w - margin));
      const y = Math.max(margin, Math.round(anchor.y - h - Math.round(8 * dpr)));

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, speech.alpha));

      const r = Math.round(6 * dpr);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, w, h, r);
      } else {
        ctx.rect(x, y, w, h);
      }
      ctx.fillStyle = 'rgba(10, 15, 29, 0.96)';
      ctx.fill();
      ctx.strokeStyle = agent.color;
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      ctx.stroke();

      // Tail pointing down at the speaker
      const tailX = Math.max(x + Math.round(10 * dpr), Math.min(anchor.x, x + w - Math.round(10 * dpr)));
      ctx.beginPath();
      ctx.moveTo(tailX - Math.round(5 * dpr), y + h - 1);
      ctx.lineTo(tailX, y + h + Math.round(7 * dpr));
      ctx.lineTo(tailX + Math.round(5 * dpr), y + h - 1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(10, 15, 29, 0.96)';
      ctx.fill();
      ctx.strokeStyle = agent.color;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x + padX, y + padY + i * lineH);
      }
      ctx.restore();

      placed.push({ x1: x, y1: y, x2: x + w, y2: y + h + Math.round(7 * dpr) });
    }
  }

  wrapText(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 4);
  }
}

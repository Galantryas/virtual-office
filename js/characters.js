/**
 * 2D Virtual Dev Office - 2.5D Isometric RPG Character Engine
 * Supports 8-directional isometric movement, 3D relief shading, occlusion X-Ray, and depth-sorting.
 */

class AgentCharacter {
  constructor(config, startWpKey = 'pantry_center') {
    this.id = config.id;
    this.name = config.name;
    this.fullName = config.fullName;
    this.role = config.role;
    this.tag = config.tag;
    this.color = config.color;
    this.emoji = config.emoji;
    this.hairColor = config.hairColor;
    this.outfitColor = config.outfitColor;
    this.pantsColor = config.pantsColor;
    this.skinColor = config.skinColor;
    this.accessory = config.accessory;
    this.defaultRoom = config.defaultRoom;
    this.targetStation = config.targetStation;

    // Position & Coordinates
    const startWp = WAYPOINTS[startWpKey] || { x: 200, y: 150 };
    this.x = startWp.x;
    this.y = startWp.y;
    this.targetX = startWp.x;
    this.targetY = startWp.y;
    this.currentWpKey = startWpKey;

    // Movement & Waypoints
    this.path = [];
    this.speed = 2.4;
    // 2.5D Isometric Facing Directions: 'SE', 'SW', 'NE', 'NW', 'S', 'N', 'E', 'W'
    this.facing = 'SE';
    this.walkCycle = 0;
    this.isMoving = false;

    // State: 'IDLE', 'WALKING', 'MEETING', 'CODING', 'REVIEWING'
    this.state = 'IDLE';

    // Micro-motion & 2.5D Occlusion State
    this.animTimer = Math.floor(Math.random() * 100);
    this.blinkTimer = Math.floor(Math.random() * 200) + 100;
    this.isBlinking = false;
    this.isOccluded = false; // X-Ray transparency when behind tall objects
    this.idleActionTimer = Math.floor(Math.random() * 300) + 150;

    // Speech Bubble
    this.speech = {
      text: '',
      icon: this.emoji,
      timer: 0,
      maxTimer: 180,
      alpha: 0
    };

    // Desk typing animation
    this.typingTimer = 0;
  }

  // Anchor Y for Y-sorting / depth ordering in 2.5D
  get anchorY() {
    return this.y;
  }

  // Is the agent occupying a chair / desk seat instead of standing in an aisle?
  // Seated sprites sink into the seat, fold their legs and reach hands forward, so a
  // parked agent never looks like it is standing on top of its chair.
  isSeated() {
    const wp = this.currentWpKey || '';

    // Parked on a chair/desk or a boardroom seat (never while only walking past it)
    if (!this.isMoving && (/_(chair|desk)$/.test(wp) || /^war_table_(head|seat\d+)$/.test(wp))) {
      return true;
    }

    // Sitting / napping on the lounge sofa
    if ((this.state === 'SITTING' || this.state === 'SLEEPING') && /^pantry_sofa_/.test(wp)) {
      return true;
    }

    // Attending the boardroom meeting (table or whiteboard)
    if (this.state === 'MEETING' && (/^war_table_/.test(wp) || wp === 'war_whiteboard')) {
      return true;
    }

    // Working at a desk chair
    if ((this.state === 'CODING' || this.state === 'REVIEWING') && /_(chair|desk)$/.test(wp)) {
      return true;
    }

    return false;
  }

  // Boardroom facing: the head faces the table, north-side seats look south,
  // south-side seats look north and the whiteboard presenter faces the room.
  getMeetingFacing() {
    const wp = this.currentWpKey;

    if (wp === 'war_whiteboard') return 'N';
    if (wp === 'war_table_head') return 'SE';

    if (wp && /^war_table_seat\d+$/.test(wp) && WAYPOINTS[wp]) {
      return WAYPOINTS[wp].y < 195 ? 'S' : 'N';
    }

    return 'SW';
  }

  // Set destination waypoint with pathfinding
  moveToWaypoint(targetWpKey, onComplete = null) {
    if (!WAYPOINTS[targetWpKey]) return;

    const path = pathfinder.findPathFromCoord(this.x, this.y, targetWpKey);
    if (path && path.length > 0) {
      this.path = path;
      this.targetWpKey = targetWpKey;
      this.onMoveComplete = onComplete;
      this.state = 'WALKING';
      this.isMoving = true;
    } else {
      const dest = WAYPOINTS[targetWpKey];
      this.x = dest.x;
      this.y = dest.y;
      this.currentWpKey = targetWpKey;
      if (onComplete) onComplete();
    }
  }

  // Say something in floating isometric speech bubble
  say(text, durationFrames = 220, customIcon = null) {
    this.speech.text = text;
    this.speech.icon = customIcon || this.getIconForText(text);
    this.speech.timer = durationFrames;
    this.speech.maxTimer = durationFrames;
    this.speech.alpha = 1.0;
  }

  getIconForText(text) {
    if (text.includes('â˜•') || text.toLowerCase().includes('kopi') || text.toLowerCase().includes('espresso')) return 'â˜•';
    if (text.toLowerCase().includes('coding') || text.toLowerCase().includes('controller') || text.toLowerCase().includes('html')) return 'ðŸ’»';
    if (text.toLowerCase().includes('database') || text.toLowerCase().includes('sql') || text.toLowerCase().includes('arsitektur')) return 'ðŸ—„ï¸';
    if (text.toLowerCase().includes('audit') || text.toLowerCase().includes('security') || text.toLowerCase().includes('qa')) return 'ðŸ›¡ï¸';
    if (text.toLowerCase().includes('sprint') || text.toLowerCase().includes('backlog') || text.toLowerCase().includes('scope')) return 'ðŸ“‹';
    return this.emoji;
  }

  // Update logic per frame
  update(renderer) {
    this.animTimer++;

    // 1. Eye Blink Cycle
    this.blinkTimer--;
    if (this.blinkTimer <= 0) {
      this.isBlinking = true;
      if (this.blinkTimer <= -5) {
        this.isBlinking = false;
        this.blinkTimer = Math.floor(Math.random() * 220) + 120;
      }
    }

    // 2. Speech Bubble Timer
    if (this.speech.timer > 0) {
      this.speech.timer--;
      if (this.speech.timer < 30) {
        this.speech.alpha = this.speech.timer / 30;
      }
    } else {
      this.speech.text = '';
      this.speech.alpha = 0;
    }

    // 3. 2.5D Isometric Waypoint Navigation & 8-Direction Facing
    if (this.path.length > 0) {
      const nextNode = this.path[0];
      const dx = nextNode.x - this.x;
      const dy = nextNode.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Determine 2.5D Isometric 8-Direction Facing
      const angle = Math.atan2(dy, dx); // radians
      if (angle >= -Math.PI / 8 && angle < Math.PI * 3 / 8) {
        this.facing = 'SE'; // Down-Right (towards front right)
      } else if (angle >= Math.PI * 3 / 8 && angle < Math.PI * 5 / 8) {
        this.facing = 'S'; // Straight Down
      } else if (angle >= Math.PI * 5 / 8 && angle < Math.PI * 7 / 8) {
        this.facing = 'SW'; // Down-Left (towards front left)
      } else if (angle >= -Math.PI * 3 / 8 && angle < -Math.PI / 8) {
        this.facing = 'NE'; // Up-Right (away towards back right)
      } else if (angle >= -Math.PI * 5 / 8 && angle < -Math.PI * 3 / 8) {
        this.facing = 'N'; // Straight Up
      } else if (angle >= -Math.PI * 7 / 8 && angle < -Math.PI * 5 / 8) {
        this.facing = 'NW'; // Up-Left (away towards back left)
      } else if (dx > 0) {
        this.facing = 'E';
      } else {
        this.facing = 'W';
      }

      if (dist <= this.speed) {
        this.x = nextNode.x;
        this.y = nextNode.y;
        this.currentWpKey = nextNode.key;
        this.path.shift();
        this.stuckFrames = 0;

        if (this.path.length === 0) {
          this.isMoving = false;
          if (this.onMoveComplete) {
            const cb = this.onMoveComplete;
            this.onMoveComplete = null;
            cb();
          }
        }
      } else {
        const stepX = (dx / dist) * this.speed;
        const stepY = (dy / dist) * this.speed;
        const proposedX = this.x + stepX;
        const proposedY = this.y + stepY;

        // Collision detection against office furniture and walls
        const hit = typeof isCollidingWithOfficeObstacle === 'function' ? isCollidingWithOfficeObstacle(proposedX, proposedY, 7) : null;
        if (!hit) {
          this.x = proposedX;
          this.y = proposedY;
          this.stuckFrames = 0;
        } else {
          let moved = false;

          // 1. Primary axis sliding if movement along that axis is significant
          if (Math.abs(stepX) > 0.1 && !isCollidingWithOfficeObstacle(proposedX, this.y, 6)) {
            this.x = proposedX;
            this.stuckFrames = 0;
            moved = true;
          } else if (Math.abs(stepY) > 0.1 && !isCollidingWithOfficeObstacle(this.x, proposedY, 6)) {
            this.y = proposedY;
            this.stuckFrames = 0;
            moved = true;
          }

          // 2. Arcade Tangential Sliding (Glide around corners and desks)
          if (!moved && hit) {
            if (Math.abs(dy) >= Math.abs(dx)) {
              // Blocked vertically by obstacle top/bottom: glide horizontally
              const cx = (hit.x1 + hit.x2) / 2;
              const preferredDir = (this.x < cx) ? -1 : 1;
              const dirs = [preferredDir, -preferredDir];
              for (const dir of dirs) {
                const tryX = this.x + dir * this.speed;
                if (!isCollidingWithOfficeObstacle(tryX, this.y, 6)) {
                  this.x = tryX;
                  this.stuckFrames = 0;
                  moved = true;
                  break;
                }
              }
            } else {
              // Blocked horizontally by obstacle side: glide vertically
              const cy = (hit.y1 + hit.y2) / 2;
              const preferredDir = (this.y < cy) ? -1 : 1;
              const dirs = [preferredDir, -preferredDir];
              for (const dir of dirs) {
                const tryY = this.y + dir * this.speed;
                if (!isCollidingWithOfficeObstacle(this.x, tryY, 6)) {
                  this.y = tryY;
                  this.stuckFrames = 0;
                  moved = true;
                  break;
                }
              }
            }
          }

          if (!moved) {
            // Blocked by obstacle edge: increment stuck frames
            this.stuckFrames = (this.stuckFrames || 0) + 1;

            // Intelligent Anti-Stuck Watchdog:
            if (this.stuckFrames > 8) {
              if (dist < 36) {
                // Near waypoint, advance safely
                this.x = nextNode.x;
                this.y = nextNode.y;
                this.currentWpKey = nextNode.key;
                this.path.shift();
                this.stuckFrames = 0;
                if (this.path.length === 0) {
                  this.isMoving = false;
                  if (this.onMoveComplete) {
                    const cb = this.onMoveComplete;
                    this.onMoveComplete = null;
                    cb();
                  }
                }
              } else if (this.path.length > 1) {
                // Advance to next waypoint in path
                this.path.shift();
                this.stuckFrames = 0;
              } else if (this.targetWpKey) {
                // Dynamically repath from current coordinates to target
                const repath = pathfinder.findPathFromCoord(this.x, this.y, this.targetWpKey);
                if (repath && repath.length > 0) {
                  this.path = repath;
                  this.stuckFrames = 0;
                } else if (dist < 55) {
                  // Fallback: target reached within tolerance
                  this.x = nextNode.x;
                  this.y = nextNode.y;
                  this.currentWpKey = nextNode.key;
                  this.path = [];
                  this.stuckFrames = 0;
                  this.isMoving = false;
                  if (this.onMoveComplete) {
                    const cb = this.onMoveComplete;
                    this.onMoveComplete = null;
                    cb();
                  }
                }
              }
            }
          }
        }

        this.walkCycle += 0.22;
        this.isMoving = true;

        if (Math.floor(this.walkCycle) % 8 === 0 && Math.random() < 0.25) {
          soundFx.playStep();
        }
      }
    } else {
      this.isMoving = false;
      this.stuckFrames = 0;
    }

    // Precise minimal penetration push-out if character overlaps any solid obstacle
    if (typeof isCollidingWithOfficeObstacle === 'function') {
      const overlapObs = isCollidingWithOfficeObstacle(this.x, this.y, 5);
      if (overlapObs) {
        const leftPen = Math.abs(this.x - overlapObs.x1);
        const rightPen = Math.abs(this.x - overlapObs.x2);
        const topPen = Math.abs(this.y - overlapObs.y1);
        const bottomPen = Math.abs(this.y - overlapObs.y2);
        const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);

        if (minPen === topPen) {
          this.y = overlapObs.y1 - 6;
        } else if (minPen === bottomPen) {
          this.y = overlapObs.y2 + 6;
        } else if (minPen === leftPen) {
          this.x = overlapObs.x1 - 6;
        } else {
          this.x = overlapObs.x2 + 6;
        }
      }
    }

    // 4. Role Behavior & Animations
    if (this.state === 'IDLE' && !this.isMoving) {
      this.updateIdlePantryBehavior(renderer);
    } else if (this.state === 'CODING') {
      this.facing = 'NW'; // Face isometric angled desk monitor
      this.typingTimer++;
      if (this.typingTimer % 16 === 0) {
        renderer.addCodeParticle(this.x, this.y - 18, this.color);
        if (Math.random() < 0.3) {
          soundFx.playKeyboard();
        }
      }
    } else if (this.state === 'MEETING') {
      this.facing = this.getMeetingFacing();
    } else if (this.state === 'REVIEWING') {
      this.facing = 'NW';
      this.typingTimer++;
      if (this.typingTimer % 20 === 0) {
        renderer.addCodeParticle(this.x, this.y - 18, '#f43f5e');
      }
    } else if (this.state === 'EATING' || this.state === 'DRINKING' || this.state === 'SITTING' || this.state === 'SLEEPING') {
      this.updateStandbyBehavior(renderer);
    }
  }

  // Idle wandering in Coffee Lounge / Pantry or Front Desk
  updateIdlePantryBehavior(renderer) {
    this.idleActionTimer--;
    if (this.idleActionTimer <= 0) {
      this.idleActionTimer = Math.floor(Math.random() * 320) + 200;

      // Special idle behavior for Daisy at Front Desk
      if (this.id === 'daisy') {
        const lobbySpots = [
          'reception_chair',
          'reception_chair',
          'reception_aisle_w',
          'reception_aisle_e',
          'reception_counter'
        ];
        const spot = lobbySpots[Math.floor(Math.random() * lobbySpots.length)];
        this.moveToWaypoint(spot, () => {
          if (spot === 'reception_chair') {
            this.facing = 'SE';
            const daisyLines = [
              'ðŸ›Žï¸ Selamat datang! Ada yang bisa saya bantu?',
              'ðŸ›Žï¸ Saya Daisy di Front Desk, siap melayani Q&A Anda âœ¨',
              'ðŸ›Žï¸ Butuh penjelasan fitur atau cara kerja? Tanyakan ke saya!',
              'ðŸ›Žï¸ Senang melihat suasana kantor yang produktif hari ini ðŸ˜Š'
            ];
            this.say(daisyLines[Math.floor(Math.random() * daisyLines.length)], 220, 'ðŸ›Žï¸');
          } else {
            this.facing = 'SE';
            this.say('Menata meja resepsionis dan daftar tamu ðŸ“‹', 180, 'ðŸ“‹');
          }
        });
        return;
      }

      // Weighted standby behavior: eat, drink, sit, sleep or chit-chat
      const behavior = this.pickIdleBehavior();
      if (behavior) {
        this.startIdleBehavior(behavior, renderer);
      }
    }
  }

  // Pick a weighted-random standby behavior from OFFICE_CONFIG.idleBehaviors
  pickIdleBehavior() {
    const behaviors = (typeof OFFICE_CONFIG !== 'undefined' && OFFICE_CONFIG.idleBehaviors) || [];
    if (behaviors.length === 0) return null;

    let total = 0;
    for (const b of behaviors) total += b.weight || 1;

    let roll = Math.random() * total;
    for (const b of behaviors) {
      roll -= (b.weight || 1);
      if (roll <= 0) return b;
    }
    return behaviors[behaviors.length - 1];
  }

  // Walk to a standby spot and hold the pose there
  startIdleBehavior(behavior, renderer) {
    if (this.currentWpKey === behavior.wp) {
      this.beginStandbyPose(behavior, renderer);
      return;
    }
    this.moveToWaypoint(behavior.wp, () => this.beginStandbyPose(behavior, renderer));
  }

  // Hold a standby pose (with its props) for a random duration
  beginStandbyPose(behavior, renderer) {
    const lines = behavior.lines || [];
    const minDur = behavior.minDur || 180;
    const maxDur = Math.max(minDur + 1, behavior.maxDur || minDur + 160);

    this.state = behavior.state;
    this.behaviorTimer = Math.floor(Math.random() * (maxDur - minDur)) + minDur;
    this.typingTimer = 0;

    // Face the prop the agent is using
    if (behavior.state === 'DRINKING') {
      this.facing = 'NW'; // Facing the water dispenser
    } else if (behavior.state === 'EATING') {
      this.facing = 'NW'; // Facing the coffee table
    } else if (behavior.state === 'SITTING' || behavior.state === 'SLEEPING') {
      this.facing = 'S'; // Sitting back on the lounge sofa, facing the room
    } else if (behavior.wp === 'pantry_coffee_machine') {
      this.facing = 'NW';
      soundFx.playCoffee();
      for (let i = 0; i < 4; i++) {
        renderer.addCoffeeSteam(100, 40);
      }
    }

    if (behavior.state === 'SLEEPING') {
      renderer.addZzzParticle(this.x, this.y - 30);
    } else if (lines.length > 0 && (behavior.state !== 'IDLE' || Math.random() < 0.6)) {
      this.say(lines[Math.floor(Math.random() * lines.length)], 200);
    }
  }

  // Countdown for the EATING / DRINKING / SITTING / SLEEPING poses
  updateStandbyBehavior(renderer) {
    this.behaviorTimer = (this.behaviorTimer || 0) - 1;

    if (this.state === 'SLEEPING') {
      // Floating "Zzz" above the sleeper
      if (renderer && renderer.addZzzParticle && this.behaviorTimer % 34 === 0) {
        renderer.addZzzParticle(this.x, this.y - 30);
      }
    } else if (this.state === 'EATING') {
      // A whiff of steam / crumbs from the snack
      if (renderer && renderer.addCoffeeSteam && this.behaviorTimer % 45 === 0) {
        renderer.addCoffeeSteam(this.x + 6, this.y - 22);
      }
    }

    if (this.behaviorTimer <= 0) {
      this.state = 'IDLE';
      this.idleActionTimer = Math.floor(Math.random() * 200) + 140;
    }
  }

  // Render character body (Called by depth sorting pipeline)
  // seatedPose is passed in by the renderer's depth-sorted pass (null = derive it here)
  render(ctx, seatedPose = null) {
    ctx.save();

    // Occlusion / X-Ray Effect when behind tall objects
    if (this.isOccluded) {
      ctx.globalAlpha = 0.65;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 8;
    }

    // 1. Isometric Angled Elliptical Shadow (Grounding character on diagonal floor)
    this.drawIsometricShadow(ctx);

    // 2. 2.5D Isometric Character Sprite
    this.drawIsometricSprite(ctx, seatedPose);

    ctx.restore();
  }

  // Speech bubbles are rendered by the renderer's screen-space pass now.

  // 2.5D Isometric Floor Shadow
  drawIsometricShadow(ctx) {
    const cx = Math.round(this.x);
    const cy = Math.round(this.y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    // Tilted ellipse matching 2:1 isometric ground plane
    ctx.ellipse(cx, cy + 3, 14, 7, -Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();

    // Dark core shadow under feet
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, 8, 4, -Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // =========================================================================
  // 2.5D ISOMETRIC CHARACTER SPRITE RENDERING
  // =========================================================================
  drawIsometricSprite(ctx, seatedPose = null) {
    const cx = Math.round(this.x);
    const cy = Math.round(this.y);

    // Micro-motion Oscillations
    const walkBob = this.isMoving ? Math.abs(Math.sin(this.walkCycle)) * -2 : 0;
    const walkPhase = Math.sin(this.walkCycle);
    
    // Idle breathing respiration (subtle 1px vertical respiration)
    const idleBob = (!this.isMoving && this.state !== 'CODING' && this.state !== 'SLEEPING')
      ? Math.round(Math.sin(this.animTimer * 0.08) * 0.8)
      : 0;

    // Sleeping: slow, deep breathing instead of the usual idle respiration
    const sleepBreath = (this.state === 'SLEEPING' && !this.isMoving)
      ? Math.round(Math.sin(this.animTimer * 0.03) * 1.8)
      : 0;

    // Eating: small chewing bob of the upper body
    const chewBob = (this.state === 'EATING' && !this.isMoving)
      ? Math.round(Math.sin(this.animTimer * 0.4) * 1.2)
      : 0;

    // Typing jitter
    const isTyping = (this.state === 'CODING' || this.state === 'REVIEWING');
    const typingJitter = isTyping ? (Math.sin(this.typingTimer * 0.6) * 1) : 0;

    // Seated agents sink into their chair / desk seat instead of standing on top of it.
    // The renderer passes the flag in; fall back to deriving it locally.
    const seated = (seatedPose === null || seatedPose === undefined) ? this.isSeated() : seatedPose;
    const seatDrop = seated ? 6 : 0;

    const baseY = cy - 28 + walkBob + idleBob + sleepBreath + chewBob + typingJitter + seatDrop;

    // Render based on isometric facing:
    // 'SE' (Front-Right), 'SW' (Front-Left), 'NE' (Back-Right), 'NW' (Back-Left), 'S', 'N'
    if (this.facing === 'SE' || this.facing === 'S' || this.facing === 'E') {
      this.renderIsoFrontDiagonal(ctx, cx, baseY, walkPhase, 'SE', isTyping, seated);
    } else if (this.facing === 'SW' || this.facing === 'W') {
      this.renderIsoFrontDiagonal(ctx, cx, baseY, walkPhase, 'SW', isTyping, seated);
    } else if (this.facing === 'NW' || this.facing === 'N') {
      this.renderIsoBackDiagonal(ctx, cx, baseY, walkPhase, 'NW', isTyping, seated);
    } else {
      this.renderIsoBackDiagonal(ctx, cx, baseY, walkPhase, 'NE', isTyping, seated);
    }
  }

  // --- FRONT DIAGONAL ISOMETRIC (SE / SW - Facing towards camera) ---
  renderIsoFrontDiagonal(ctx, cx, y, walkPhase, dir, isTyping, seated) {
    const outline = '#0a0d14';
    const isSE = (dir === 'SE');
    const dirSign = isSE ? 1 : -1;
    const legSwing = this.isMoving ? Math.round(walkPhase * 3) : 0;

    // 1. LEGS & SHOES (Isometric Stride)
    if (seated) {
      // Seated: legs folded away under the seat, only knees & toes peek towards the desk
      ctx.fillStyle = outline;
      ctx.fillRect(cx - 7, y + 19, 14, 5);
      ctx.fillStyle = this.pantsColor;
      ctx.fillRect(cx - 6, y + 20, 12, 3);
      ctx.fillStyle = '#1e1b2e';
      ctx.fillRect(cx - 6, y + 23, 5, 3);
      ctx.fillRect(cx + 1, y + 23, 5, 3);
    } else {
      // Back leg
      ctx.fillStyle = outline;
      ctx.fillRect(cx - 6 * dirSign - legSwing, y + 21, 6, 9);
      ctx.fillStyle = this.pantsColor;
      ctx.fillRect(cx - 5 * dirSign - legSwing, y + 21, 4, 7);
      ctx.fillStyle = '#1e1b2e';
      ctx.fillRect(cx - 6 * dirSign - legSwing, y + 26, 6, 4);

      // Front leg (closer to camera)
      ctx.fillStyle = outline;
      ctx.fillRect(cx + 2 * dirSign + legSwing, y + 22, 6, 9);
      ctx.fillStyle = this.pantsColor;
      ctx.fillRect(cx + 3 * dirSign + legSwing, y + 22, 4, 7);
      ctx.fillStyle = '#1e1b2e';
      ctx.fillRect(cx + 2 * dirSign + legSwing, y + 27, 6, 4);
      ctx.fillStyle = '#ffffff'; // White sneaker edge
      ctx.fillRect(cx + 2 * dirSign + legSwing, y + 30, 6, 1);
    }

    // 2. TORSO / JACKET / SWEATER (Isometric 3D Relief)
    // Dark outline
    ctx.fillStyle = outline;
    ctx.fillRect(cx - 9, y + 8, 18, 14);

    // Base outfit fill
    ctx.fillStyle = this.outfitColor;
    ctx.fillRect(cx - 8, y + 9, 16, 12);

    // 3D Light highlight on front-facing side
    ctx.fillStyle = isSE ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(cx - 8, y + 9, 8, 12);

    // 3D Shadow on receding side
    ctx.fillStyle = isSE ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(cx, y + 9, 8, 12);

    // Collar / Tie / Accent Stripe
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 2, y + 9, 4, 6);
    ctx.fillStyle = this.color;
    ctx.fillRect(cx - 1, y + 10, 2, 8);

    // 3. ARMS & ACCESSORIES
    // Left arm
    ctx.fillStyle = outline;
    ctx.fillRect(cx - 11, y + 9 - legSwing, 4, 9);
    ctx.fillStyle = this.outfitColor;
    ctx.fillRect(cx - 10, y + 10 - legSwing, 2, 7);
    ctx.fillStyle = this.skinColor;
    ctx.fillRect(cx - 10, y + 16 - legSwing, 2, 3); // Hand

    // Right arm
    ctx.fillStyle = outline;
    ctx.fillRect(cx + 7, y + 9 + legSwing, 4, 9);
    ctx.fillStyle = this.outfitColor;
    ctx.fillRect(cx + 8, y + 10 + legSwing, 2, 7);
    ctx.fillStyle = this.skinColor;
    ctx.fillRect(cx + 8, y + 16 + legSwing, 2, 3); // Hand

    // Seated: hands reach forward onto the desk / meeting table
    if (seated && !isTyping) {
      ctx.fillStyle = this.skinColor;
      ctx.fillRect(cx - 11, y + 12, 4, 3);
      ctx.fillRect(cx + 7, y + 12, 4, 3);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(cx - 11, y + 12, 4, 1);
      ctx.fillRect(cx + 7, y + 12, 4, 1);
    }

    // Special Props in isometric view
    if (this.state === 'EATING') {
      this.drawIsometricSnackPlate(ctx, cx + 7, y + 12);
    } else if (this.state === 'DRINKING') {
      this.drawIsometricRaisedCup(ctx, cx + 7, y + 9);
    } else if (this.accessory === 'blueprint') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx + 8, y + 13, 4, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 8, y + 15, 4, 2);
    } else if (this.id === 'scrum_master') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - 12, y + 13, 5, 7);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(cx - 11, y + 14, 3, 5);
    } else if (this.currentWpKey === 'pantry_coffee_machine' || this.currentWpKey === 'pantry_sofa_left') {
      this.drawIsometricCoffeeMug(ctx, cx + 8, y + 13);
    }

    // 4. HEAD & 3/4 ISOMETRIC FACE
    ctx.fillStyle = outline;
    ctx.fillRect(cx - 7, y - 5, 14, 14);
    ctx.fillStyle = this.skinColor;
    ctx.fillRect(cx - 6, y - 4, 12, 12);

    // 3D Isometric Shading on Jaw/Cheek
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(isSE ? cx + 2 : cx - 6, y + 4, 4, 4);

    // 5. EYES & 16-BIT SPECULAR GLINT (Angled 3/4 view)
    if (this.isBlinking || this.state === 'SLEEPING') {
      // Blinking, or fast asleep: eyes squeezed shut
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - 4, y + 2, 3, 1);
      ctx.fillRect(cx + 1, y + 2, 3, 1);
      if (this.state === 'SLEEPING') {
        ctx.fillRect(cx - 5, y + 3, 1, 1); // sleepy lash
        ctx.fillRect(cx + 4, y + 3, 1, 1);
      }
    } else {
      // 3/4 angle eyes: Closer eye slightly wider
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(cx - 4, y + 1, isSE ? 2 : 3, 3);
      ctx.fillRect(cx + 1, y + 1, isSE ? 3 : 2, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 4, y + 1, 1, 1);
      ctx.fillRect(cx + 1, y + 1, 1, 1);
    }

    // Blush
    ctx.fillStyle = 'rgba(244, 63, 94, 0.28)';
    ctx.fillRect(cx - 5, y + 4, 2, 1);
    ctx.fillRect(cx + 3, y + 4, 2, 1);

    // 6. CUSTOM HAIR & ACCESSORIES IN 2.5D
    this.renderCustomHair(ctx, cx, y, dir);
  }

  // --- BACK DIAGONAL ISOMETRIC (NW / NE - Facing away from camera) ---
  renderIsoBackDiagonal(ctx, cx, y, walkPhase, dir, isTyping, seated) {
    const outline = '#0c101a';
    const isNW = (dir === 'NW');
    const dirSign = isNW ? -1 : 1;
    const legSwing = this.isMoving ? Math.round(walkPhase * 3) : 0;

    // Legs from behind
    if (seated) {
      // Seated: legs folded under the seat, heels tucked out of sight
      ctx.fillStyle = outline;
      ctx.fillRect(cx - 7, y + 19, 14, 5);
      ctx.fillStyle = this.pantsColor;
      ctx.fillRect(cx - 6, y + 20, 12, 3);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - 6, y + 23, 5, 3);
      ctx.fillRect(cx + 1, y + 23, 5, 3);
    } else {
      ctx.fillStyle = outline;
      ctx.fillRect(cx - 6 * dirSign - legSwing, y + 21, 6, 8);
      ctx.fillRect(cx + 2 * dirSign + legSwing, y + 21, 6, 8);
      ctx.fillStyle = this.pantsColor;
      ctx.fillRect(cx - 5 * dirSign - legSwing, y + 21, 4, 6);
      ctx.fillRect(cx + 3 * dirSign + legSwing, y + 21, 4, 6);
      ctx.fillStyle = '#0f172a'; // Shoe heels
      ctx.fillRect(cx - 6 * dirSign - legSwing, y + 26, 6, 4);
      ctx.fillRect(cx + 2 * dirSign + legSwing, y + 26, 6, 4);
    }

    // Torso from back
    ctx.fillStyle = outline;
    ctx.fillRect(cx - 9, y + 8, 18, 14);
    ctx.fillStyle = this.outfitColor;
    ctx.fillRect(cx - 8, y + 9, 16, 12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(cx - 5, y + 9, 10, 5); // collar/hoodie back

    // Arms
    ctx.fillStyle = outline;
    ctx.fillRect(cx - 11, y + 9, 4, 9);
    ctx.fillRect(cx + 7, y + 9, 4, 9);
    ctx.fillStyle = this.outfitColor;
    ctx.fillRect(cx - 10, y + 10, 2, 8);
    ctx.fillRect(cx + 8, y + 10, 2, 8);

    // Desk typing hands forward (facing monitor)
    if (isTyping) {
      const typeHandBob = Math.sin(this.typingTimer * 0.9) * 2;
      ctx.fillStyle = this.skinColor;
      ctx.fillRect(cx - 7, y + 4 + typeHandBob, 4, 3);
      ctx.fillRect(cx + 3, y + 4 - typeHandBob, 4, 3);
    }

    // Eating / drinking props stay visible even with the back turned to the camera
    if (this.state === 'DRINKING') {
      this.drawIsometricRaisedCup(ctx, cx - 11, y + 8);
    } else if (this.state === 'EATING') {
      this.drawIsometricSnackPlate(ctx, cx - 11, y + 14);
    }

    // Head & Hair from back
    ctx.fillStyle = outline;
    ctx.fillRect(cx - 7, y - 6, 14, 15);
    ctx.fillStyle = this.hairColor;
    ctx.fillRect(cx - 6, y - 5, 12, 14);

    // Hair volume highlight & shadow
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(cx - 4, y - 4, 8, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(cx - 5, y + 4, 10, 4);

    // Headphones if Reza
    if (this.accessory === 'headphones') {
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(cx - 7, y - 7, 14, 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx - 8, y - 2, 2, 5);
      ctx.fillRect(cx + 6, y - 2, 2, 5);
    }
  }

  // Character-specific isometric hair and accessories
  renderCustomHair(ctx, cx, y, dir) {
    const isSE = (dir === 'SE');

    if (this.id === 'scrum_master') {
      ctx.fillStyle = this.hairColor;
      ctx.fillRect(cx - 7, y - 7, 14, 6);
      ctx.fillRect(cx - 7, y - 2, 3, 5);
      ctx.fillRect(cx + 4, y - 2, 3, 5);
      // High bun
      ctx.fillRect(cx - 4, y - 10, 8, 4);
      ctx.fillStyle = '#fbbf24'; // Gold hairpin
      ctx.fillRect(cx - 1, y - 9, 3, 2);

      // Glasses glint
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 5, y, 4, 4);
      ctx.strokeRect(cx + 1, y, 4, 4);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.fillRect(cx - 4, y + 1, 1, 1);
      ctx.fillRect(cx + 2, y + 1, 1, 1);
    } else if (this.id === 'system_architect') {
      ctx.fillStyle = this.hairColor;
      ctx.fillRect(cx - 7, y - 7, 14, 6);
      ctx.fillRect(cx - 8, y - 3, 3, 5);
      ctx.fillRect(cx + 5, y - 3, 3, 5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(cx - 4, y - 6, 6, 2);

      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 5, y + 1, 4, 3);
      ctx.strokeRect(cx + 1, y + 1, 4, 3);
    } else if (this.id === 'backend_dev') {
      ctx.fillStyle = this.hairColor;
      ctx.fillRect(cx - 7, y - 7, 14, 6);
      ctx.fillRect(cx - 8, y - 2, 3, 6);
      ctx.fillRect(cx + 5, y - 2, 3, 6);
      ctx.fillRect(cx - 5, y - 8, 3, 2);
      ctx.fillRect(cx + 2, y - 8, 3, 2);

      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(cx - 9, y - 2, 3, 6);
      ctx.fillRect(cx + 6, y - 2, 3, 6);
      ctx.fillRect(cx - 7, y - 7, 14, 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx - 8, y, 1, 2);
      ctx.fillRect(cx + 7, y, 1, 2);
    } else if (this.id === 'frontend_dev') {
      ctx.fillStyle = this.hairColor;
      ctx.fillRect(cx - 7, y - 4, 14, 5);
      ctx.fillRect(cx - 8, y - 1, 3, 8);
      ctx.fillRect(cx + 5, y - 1, 3, 8);

      ctx.fillStyle = '#0891b2';
      ctx.fillRect(cx - 8, y - 9, 16, 5);
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(cx - 6, y - 10, 12, 3);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cx + 3, y - 11, 3, 2);
    } else if (this.id === 'qa_engineer') {
      ctx.fillStyle = this.hairColor;
      ctx.fillRect(cx - 7, y - 7, 14, 6);
      ctx.fillRect(cx - 6, y - 9, 3, 3);
      ctx.fillRect(cx - 1, y - 9, 3, 3);
      ctx.fillRect(cx + 4, y - 9, 3, 3);

      const scanOffset = Math.floor(this.animTimer * 0.1) % 6;
      ctx.fillStyle = '#9f1239';
      ctx.fillRect(cx - 6, y, 12, 4);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(cx - 5, y + 1, 10, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 4 + scanOffset, y + 1, 2, 2);
    } else if (this.id === 'daisy') {
      // Golden blonde stylish hair with bangs & daisy clip
      ctx.fillStyle = this.hairColor;
      ctx.fillRect(cx - 8, y - 8, 16, 7);
      ctx.fillRect(cx - 9, y - 2, 4, 10);
      ctx.fillRect(cx + 5, y - 2, 4, 10);
      // Bangs
      ctx.fillRect(cx - 6, y - 3, 12, 3);
      // Flowing hair strands
      ctx.fillRect(cx - 8, y + 6, 3, 4);
      ctx.fillRect(cx + 5, y + 6, 3, 4);

      // Cute Daisy Flower Hair Clip on the right
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 4, y - 8, 5, 5);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(cx + 5, y - 7, 3, 3);
    }
  }

  drawIsometricCoffeeMug(ctx, x, y) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x, y, 6, 7);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + 5, y + 2, 2, 3);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(x + 1, y + 1, 4, 2);

    const steamWiggle = Math.sin(this.animTimer * 0.15) * 1.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(x + 2 + steamWiggle, y - 3, 1.5, 2);
  }

  // Small snack plate with a bite, held in front of the chest (EATING)
  drawIsometricSnackPlate(ctx, x, y) {
    const chew = Math.round(Math.sin(this.animTimer * 0.4) * 1);

    // Plate
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x, y + chew, 11, 6);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x + 1, y + 1 + chew, 9, 4);

    // Sandwich & donut on the plate
    ctx.fillStyle = '#d97706';
    ctx.fillRect(x + 2, y - 2 + chew, 7, 4);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(x + 3, y - 1 + chew, 5, 2);
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(x + 5, y - 4 + chew, 4, 3);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x + 6, y - 3 + chew, 2, 1);
  }

  // Cup raised towards the mouth (DRINKING)
  drawIsometricRaisedCup(ctx, x, y) {
    const sip = Math.round(Math.sin(this.animTimer * 0.25) * 1);

    // Forearm linking the cup to the shoulder
    ctx.fillStyle = this.skinColor;
    ctx.fillRect(x + 3, y + 6 + sip, 2, 5);

    // Porcelain cup
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x + 1, y + sip, 6, 7);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x + 1, y + sip, 6, 1);
    ctx.fillStyle = '#92400e'; // Coffee surface
    ctx.fillRect(x + 2, y + 1 + sip, 4, 2);
    ctx.fillStyle = '#0f172a'; // Handle
    ctx.fillRect(x + 6, y + 2 + sip, 2, 3);
  }
}

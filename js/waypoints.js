/**
 * 2D Virtual Dev Office - Waypoint Graph, Pathfinding Engine & Physical Collision
 * Provides realistic collision-free movement between rooms via corridors, preventing clipping through furniture.
 */

// Furniture and Room Wall Collision Boxes (AABB)
const OFFICE_OBSTACLES = [
  // --- PANTRY PROPS ---
  { id: 'pantry_counter', x1: 45, y1: 48, x2: 275, y2: 96, label: 'Coffee Counter' },
  { id: 'pantry_fridge', x1: 275, y1: 28, x2: 320, y2: 90, label: 'Refrigerator' },
  { id: 'pantry_water', x1: 325, y1: 50, x2: 360, y2: 94, label: 'Water Dispenser' },
  { id: 'pantry_sofa', x1: 198, y1: 120, x2: 328, y2: 152, label: 'Lounge Fabric Sofa' },
  { id: 'pantry_table', x1: 218, y1: 185, x2: 308, y2: 232, label: 'Coffee Table' },
  { id: 'pantry_plant1', x1: 45, y1: 105, x2: 75, y2: 135, label: 'Plant' },
  { id: 'pantry_plant2', x1: 45, y1: 275, x2: 75, y2: 305, label: 'Plant' },

  // --- SCRUM & MEETING ROOM PROPS ---
  { id: 'war_whiteboard', x1: 615, y1: 28, x2: 885, y2: 80, label: 'Whiteboard & Screen' },
  // Symmetrically Centered Boardroom Table: spans x: 622 to 852, y: 148 to 242
  { id: 'war_table', x1: 622, y1: 148, x2: 852, y2: 242, label: 'Boardroom Table' },
  { id: 'war_plant1', x1: 545, y1: 45, x2: 575, y2: 75, label: 'Plant' },
  { id: 'war_plant2', x1: 935, y1: 265, x2: 965, y2: 295, label: 'Plant' },

  // --- DEV CUBICLES PROPS ---
  { id: 'dev_bookshelf', x1: 45, y1: 370, x2: 150, y2: 402, label: 'Tech Bookshelf' },
  { id: 'dev_backend_desk', x1: 65, y1: 465, x2: 215, y2: 542, label: 'Backend Desk' },
  { id: 'dev_divider', x1: 225, y1: 445, x2: 240, y2: 546, label: 'Cubicle Divider' },
  { id: 'dev_frontend_desk', x1: 265, y1: 465, x2: 415, y2: 542, label: 'Frontend Desk' },

  // --- QA & SERVER ROOM PROPS ---
  { id: 'qa_workstation', x1: 615, y1: 465, x2: 765, y2: 542, label: 'QA Workstation' },
  { id: 'qa_servers', x1: 835, y1: 400, x2: 940, y2: 640, label: 'Server Racks Cluster' },

  // --- FRONT DESK & RECEPTION PROPS ---
  { id: 'reception_counter', x1: 415, y1: 735, x2: 585, y2: 770, label: 'Reception Counter' },
  { id: 'reception_lounge_left', x1: 90, y1: 735, x2: 210, y2: 775, label: 'Waiting Lounge Left' },
  { id: 'reception_lounge_right', x1: 790, y1: 735, x2: 910, y2: 775, label: 'Waiting Lounge Right' },
  { id: 'reception_plant_l', x1: 35, y1: 685, x2: 65, y2: 715, label: 'Plant Lobby Left' },
  { id: 'reception_plant_r', x1: 935, y1: 685, x2: 965, y2: 715, label: 'Plant Lobby Right' },

  // --- BOUNDARY & DIVIDING WALLS ---
  // Outer perimeter walls
  { id: 'wall_north', x1: 20, y1: 15, x2: 980, y2: 36 },
  { id: 'wall_west', x1: 15, y1: 20, x2: 28, y2: 845 },
  { id: 'wall_east', x1: 970, y1: 20, x2: 985, y2: 845 },
  { id: 'wall_south', x1: 20, y1: 835, x2: 980, y2: 848 },

  // Divider between Dev/QA and Front Desk (with wide central opening at x: 430..570)
  { id: 'wall_mid_south_left', x1: 20, y1: 668, x2: 430, y2: 678 },
  { id: 'wall_mid_south_right', x1: 570, y1: 668, x2: 980, y2: 678 },

  // Horizontal divider walls (between top & bottom rooms, with doorways at x: 405..470 and x: 530..595)
  { id: 'wall_h_left', x1: 20, y1: 328, x2: 405, y2: 344 },
  { id: 'wall_h_l_corner', x1: 470, y1: 328, x2: 496, y2: 344 },
  { id: 'wall_h_r_corner', x1: 504, y1: 328, x2: 530, y2: 344 },
  { id: 'wall_h_right', x1: 595, y1: 328, x2: 980, y2: 344 },

  // Ultra-slim single vertical partition wall (8px thickness at x: 496..504, with doors and open central crossing)
  { id: 'wall_v_1', x1: 496, y1: 20, x2: 504, y2: 180 },
  { id: 'wall_v_2', x1: 496, y1: 260, x2: 504, y2: 328 },
  // Open central horizontal corridor at y: 328..372
  { id: 'wall_v_3', x1: 496, y1: 372, x2: 504, y2: 440 },
  { id: 'wall_v_4', x1: 496, y1: 520, x2: 504, y2: 636 }
];

// Helper to check circle-AABB collision against all office obstacles
function isCollidingWithOfficeObstacle(x, y, radius = 7) {
  for (let i = 0; i < OFFICE_OBSTACLES.length; i++) {
    const obs = OFFICE_OBSTACLES[i];
    const closestX = Math.max(obs.x1, Math.min(x, obs.x2));
    const closestY = Math.max(obs.y1, Math.min(y, obs.y2));
    const dx = x - closestX;
    const dy = y - closestY;
    if ((dx * dx + dy * dy) < (radius * radius)) {
      return obs;
    }
  }
  return null;
}

// Check if line segment (x1, y1) -> (x2, y2) intersects an AABB box with padding
function lineIntersectsAABB(x1, y1, x2, y2, box, padding = 7) {
  const minX = box.x1 - padding;
  const maxX = box.x2 + padding;
  const minY = box.y1 - padding;
  const maxY = box.y2 + padding;

  let tmin = 0.0;
  let tmax = 1.0;
  const dx = x2 - x1;
  const dy = y2 - y1;

  // X slab
  if (Math.abs(dx) < 1e-6) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    const invD = 1.0 / dx;
    let t1 = (minX - x1) * invD;
    let t2 = (maxX - x1) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  // Y slab
  if (Math.abs(dy) < 1e-6) {
    if (y1 < minY || y1 > maxY) return false;
  } else {
    const invD = 1.0 / dy;
    let t1 = (minY - y1) * invD;
    let t2 = (maxY - y1) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  return true;
}

// Line-of-sight test ensuring straight line is not obstructed by furniture or walls
function hasLineOfSight(x1, y1, x2, y2, padding = 7) {
  for (let i = 0; i < OFFICE_OBSTACLES.length; i++) {
    if (lineIntersectsAABB(x1, y1, x2, y2, OFFICE_OBSTACLES[i], padding)) {
      return false;
    }
  }
  return true;
}

const WAYPOINTS = {
  // --- PANTRY / COFFEE LOUNGE (Top-Left) ---
  'pantry_coffee_machine': { x: 120, y: 110, room: 'pantry', label: 'Coffee Machine' },
  'pantry_water':          { x: 360, y: 110, room: 'pantry', label: 'Water Dispenser' },
  'pantry_sofa_left':      { x: 160, y: 140, room: 'pantry', label: 'Lounge Sofa Left' },
  'pantry_sofa_right':     { x: 360, y: 150, room: 'pantry', label: 'Lounge Sofa Right' },
  'pantry_aisle_west':     { x: 160, y: 260, room: 'pantry', label: 'Pantry West Aisle' },
  'pantry_table':          { x: 263, y: 260, room: 'pantry', label: 'Coffee Table' },
  'pantry_aisle_south':    { x: 370, y: 260, room: 'pantry', label: 'Pantry South Aisle' },
  'pantry_center':         { x: 370, y: 200, room: 'pantry', label: 'Pantry Center Aisle' },
  'pantry_door':           { x: 470, y: 220, room: 'pantry', label: 'Pantry East Door' },
  'pantry_door_south':     { x: 440, y: 300, room: 'pantry', label: 'Pantry South Exit' },

  // --- SCRUM & MEETING ROOM (Top-Right) ---
  'war_door':              { x: 530, y: 220, room: 'war_room', label: 'Meeting Room West Door' },
  'war_door_south':        { x: 560, y: 300, room: 'war_room', label: 'Meeting South Exit' },
  'war_aisle_west':        { x: 575, y: 195, room: 'war_room', label: 'Meeting Room West Aisle' },
  'war_center':            { x: 575, y: 195, room: 'war_room', label: 'Meeting Room Center' },
  'war_table_head':        { x: 595, y: 195, room: 'war_room', label: 'Conference Table Head (Scrum Master)' },
  'war_aisle_north_west':  { x: 575, y: 115, room: 'war_room', label: 'Meeting North-West Corner' },
  'war_whiteboard':        { x: 740, y: 115, room: 'war_room', label: 'Whiteboard & Projector' },
  'war_table_seat3':       { x: 740, y: 115, room: 'war_room', label: 'Conference Table Seat 3' },
  'war_aisle_north_east':  { x: 885, y: 115, room: 'war_room', label: 'Meeting North-East Corner' },
  'war_aisle_east':        { x: 885, y: 195, room: 'war_room', label: 'Meeting Room East Aisle' },
  'war_aisle_south_east':  { x: 885, y: 275, room: 'war_room', label: 'Meeting South-East Corner' },
  'war_table_seat2':       { x: 785, y: 275, room: 'war_room', label: 'Conference Table Seat 2' },
  'war_table_seat1':       { x: 737, y: 275, room: 'war_room', label: 'Conference Table Seat (Architect)' },
  'war_table_seat4':       { x: 665, y: 115, room: 'war_room', label: 'Conference Table Seat 4 (North)' },
  'war_table_seat5':       { x: 830, y: 275, room: 'war_room', label: 'Conference Table Seat 5 (South)' },
  'war_aisle_south_west':  { x: 575, y: 275, room: 'war_room', label: 'Meeting South-West Corner' },

  // --- DEVELOPER CUBICLES (Bottom-Left) ---
  'dev_door_north':        { x: 440, y: 400, room: 'dev_cubicles', label: 'Dev North Entrance' },
  'dev_door':              { x: 470, y: 480, room: 'dev_cubicles', label: 'Dev East Door' },
  'dev_center':            { x: 250, y: 400, room: 'dev_cubicles', label: 'Dev North Hallway' },
  'dev_bookshelf':         { x: 110, y: 400, room: 'dev_cubicles', label: 'Tech Bookshelf Area' },
  'dev_aisle_west':        { x: 45,  y: 415, room: 'dev_cubicles', label: 'Dev West Aisle North' },
  'dev_backend_approach':  { x: 45,  y: 565, room: 'dev_cubicles', label: 'Backend Chair Approach' },
  'dev_backend_chair':     { x: 150, y: 565, room: 'dev_cubicles', label: 'Backend Desk Chair' },
  'dev_south_corridor':    { x: 250, y: 565, room: 'dev_cubicles', label: 'Dev South Walkway' },
  'dev_frontend_chair':    { x: 340, y: 565, room: 'dev_cubicles', label: 'Frontend Desk Chair' },
  'dev_frontend_approach': { x: 445, y: 565, room: 'dev_cubicles', label: 'Frontend Chair Approach' },
  'dev_aisle_east':        { x: 445, y: 415, room: 'dev_cubicles', label: 'Dev East Aisle North' },

  // --- QA & SERVER ROOM (Bottom-Right) ---
  'qa_door_north':         { x: 560, y: 400, room: 'qa_server', label: 'QA North Entrance' },
  'qa_center':             { x: 680, y: 400, room: 'qa_server', label: 'QA North Hallway' },
  'qa_aisle_mid':          { x: 800, y: 400, room: 'qa_server', label: 'QA Server Aisle North' },
  'qa_door':               { x: 530, y: 480, room: 'qa_server', label: 'QA West Door' },
  'qa_aisle_west':         { x: 560, y: 480, room: 'qa_server', label: 'QA West Aisle' },
  'qa_desk_approach':      { x: 560, y: 565, room: 'qa_server', label: 'QA Chair Approach' },
  'qa_server_desk':        { x: 680, y: 565, room: 'qa_server', label: 'QA Testing Desk Chair' },
  'qa_server_rack1':       { x: 800, y: 480, room: 'qa_server', label: 'Server Rack Alpha' },
  'qa_server_rack2':       { x: 800, y: 565, room: 'qa_server', label: 'Server Rack Beta' },

  // --- CENTRAL CORRIDORS & JUNCTIONS ---
  'hub_west':              { x: 440, y: 350, room: 'hallway', label: 'Central Corridor West' },
  'hallway_center':        { x: 500, y: 350, room: 'hallway', label: 'Central Plaza' },
  'hub_east':              { x: 560, y: 350, room: 'hallway', label: 'Central Corridor East' },

  // --- FRONT DESK & RECEPTION (Lobby) ---
  'fd_entry_dev':          { x: 445, y: 640, room: 'front_desk', label: 'Lobby Dev Entry' },
  'fd_entry_qa':           { x: 560, y: 640, room: 'front_desk', label: 'Lobby QA Entry' },
  'reception_entrance':    { x: 500, y: 650, room: 'front_desk', label: 'Reception Lobby Gate' },
  'reception_chair':       { x: 500, y: 715, room: 'front_desk', label: 'Daisy Reception Station' },
  'reception_counter':     { x: 500, y: 795, room: 'front_desk', label: 'Reception Counter Guest Side' },
  'reception_aisle_w':     { x: 360, y: 715, room: 'front_desk', label: 'Reception Aisle West' },
  'reception_aisle_e':     { x: 640, y: 715, room: 'front_desk', label: 'Reception Aisle East' },
  'reception_lobby_west':  { x: 250, y: 795, room: 'front_desk', label: 'Lobby Lounge West' },
  'reception_lobby_east':  { x: 750, y: 795, room: 'front_desk', label: 'Lobby Lounge East' }
};

// Graph Edges (Connections between waypoints)
const WAYPOINT_EDGES = [
  // Pantry Internal (Loop around sofa and coffee table)
  ['pantry_coffee_machine', 'pantry_water'],
  ['pantry_coffee_machine', 'pantry_sofa_left'],
  ['pantry_sofa_left', 'pantry_aisle_west'],
  ['pantry_aisle_west', 'pantry_table'],
  ['pantry_table', 'pantry_aisle_south'],
  ['pantry_water', 'pantry_sofa_right'],
  ['pantry_sofa_right', 'pantry_center'],
  ['pantry_center', 'pantry_aisle_south'],
  ['pantry_center', 'pantry_door'],
  ['pantry_aisle_south', 'pantry_door_south'],
  ['pantry_door', 'pantry_door_south'],

  // Meeting Room Internal (Complete 4-Sided Loop Around Boardroom Table)
  ['war_door', 'war_aisle_west'],
  ['war_door_south', 'war_aisle_south_west'],
  ['war_aisle_south_west', 'war_aisle_west'],
  ['war_aisle_west', 'war_table_head'],
  ['war_aisle_west', 'war_aisle_north_west'],
  ['war_aisle_north_west', 'war_whiteboard'],
  ['war_whiteboard', 'war_table_seat3'],
  ['war_whiteboard', 'war_aisle_north_east'],
  ['war_table_seat3', 'war_aisle_north_east'],
  ['war_aisle_north_east', 'war_aisle_east'],
  ['war_aisle_east', 'war_aisle_south_east'],
  ['war_aisle_south_east', 'war_table_seat2'],
  ['war_table_seat2', 'war_table_seat1'],
  ['war_table_seat1', 'war_aisle_south_west'],

  // Extra boardroom seats (5+ attendees) hooked onto the north / south aisles
  ['war_table_seat4', 'war_aisle_north_west'],
  ['war_table_seat4', 'war_whiteboard'],
  ['war_table_seat4', 'war_aisle_north_east'],
  ['war_table_seat5', 'war_table_seat1'],
  ['war_table_seat5', 'war_aisle_south_east'],

  // Dev Cubicles Internal (Full Outer Loop Around Desks)
  ['dev_door_north', 'dev_center'],
  ['dev_door_north', 'dev_aisle_east'],
  ['dev_center', 'dev_bookshelf'],
  ['dev_bookshelf', 'dev_aisle_west'],
  ['dev_aisle_west', 'dev_backend_approach'],
  ['dev_backend_approach', 'dev_backend_chair'],
  ['dev_backend_chair', 'dev_south_corridor'],
  ['dev_south_corridor', 'dev_frontend_chair'],
  ['dev_frontend_chair', 'dev_frontend_approach'],
  ['dev_frontend_approach', 'dev_aisle_east'],
  ['dev_aisle_east', 'dev_door_north'],
  ['dev_door', 'dev_aisle_east'],
  ['dev_door', 'dev_frontend_approach'],

  // QA & Server Room Internal (Loop around workstation desk)
  ['qa_door_north', 'qa_center'],
  ['qa_door_north', 'qa_aisle_west'],
  ['qa_center', 'qa_aisle_mid'],
  ['qa_aisle_mid', 'qa_server_rack1'],
  ['qa_server_rack1', 'qa_server_rack2'],
  ['qa_server_rack2', 'qa_server_desk'],
  ['qa_server_desk', 'qa_desk_approach'],
  ['qa_desk_approach', 'qa_aisle_west'],
  ['qa_door', 'qa_aisle_west'],
  ['qa_door', 'qa_door_north'],

  // --- CROSS-ROOM & CORRIDOR DIRECT CONNECTORS ---
  // Top Direct Doorway (Pantry <-> Meeting Room)
  ['pantry_door', 'war_door'],

  // Bottom Direct Doorway (Dev Cubicles <-> QA Room)
  ['dev_door', 'qa_door'],

  // North-South Left Side (Pantry <-> Dev Cubicles via Hub West)
  ['pantry_door_south', 'hub_west'],
  ['hub_west', 'dev_door_north'],

  // North-South Right Side (Meeting Room <-> QA Room via Hub East)
  ['war_door_south', 'hub_east'],
  ['hub_east', 'qa_door_north'],

  // Central Horizontal Walkway Across Plaza
  ['hub_west', 'hallway_center'],
  ['hallway_center', 'hub_east'],

  // Front Desk / Lobby Connectors
  ['dev_frontend_approach', 'fd_entry_dev'],
  ['qa_desk_approach', 'fd_entry_qa'],
  ['fd_entry_dev', 'reception_entrance'],
  ['fd_entry_qa', 'reception_entrance'],
  ['reception_entrance', 'reception_aisle_w'],
  ['reception_entrance', 'reception_aisle_e'],
  ['reception_aisle_w', 'reception_chair'],
  ['reception_aisle_e', 'reception_chair'],
  ['reception_aisle_w', 'reception_lobby_west'],
  ['reception_aisle_e', 'reception_lobby_east'],
  ['reception_lobby_west', 'reception_counter'],
  ['reception_lobby_east', 'reception_counter']
];

class PathfindingEngine {
  constructor(waypoints, edges) {
    this.waypoints = waypoints;
    this.edges = edges;
    this.adjacency = {};
    this.buildGraph();
  }

  buildGraph() {
    for (const key of Object.keys(this.waypoints)) {
      this.adjacency[key] = [];
    }
    for (const [from, to] of this.edges) {
      if (this.waypoints[from] && this.waypoints[to]) {
        const dist = this.getDistance(this.waypoints[from], this.waypoints[to]);
        this.adjacency[from].push({ node: to, dist });
        this.adjacency[to].push({ node: from, dist });
      }
    }
  }

  getDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Find nearest waypoint to a given (x, y) coordinate
  getNearestWaypoint(x, y, roomHint = null) {
    let nearestKey = null;
    let minDist = Infinity;

    for (const [key, wp] of Object.entries(this.waypoints)) {
      if (roomHint && wp.room !== roomHint && wp.room !== 'hallway') {
        continue;
      }
      const dist = this.getDistance({ x, y }, wp);
      if (dist < minDist) {
        minDist = dist;
        nearestKey = key;
      }
    }

    if (!nearestKey) {
      // Fallback without room constraint
      for (const [key, wp] of Object.entries(this.waypoints)) {
        const dist = this.getDistance({ x, y }, wp);
        if (dist < minDist) {
          minDist = dist;
          nearestKey = key;
        }
      }
    }

    return nearestKey;
  }

  // Dijkstra shortest path between two waypoint keys
  findPath(startKey, targetKey) {
    if (!this.waypoints[startKey] || !this.waypoints[targetKey]) {
      return [];
    }
    if (startKey === targetKey) {
      return [{ ...this.waypoints[targetKey], key: targetKey }];
    }

    const distances = {};
    const previous = {};
    const unvisited = new Set(Object.keys(this.waypoints));

    for (const key of Object.keys(this.waypoints)) {
      distances[key] = Infinity;
      previous[key] = null;
    }
    distances[startKey] = 0;

    while (unvisited.size > 0) {
      let current = null;
      let lowestDist = Infinity;
      for (const node of unvisited) {
        if (distances[node] < lowestDist) {
          lowestDist = distances[node];
          current = node;
        }
      }

      if (current === null || current === targetKey || distances[current] === Infinity) {
        break;
      }

      unvisited.delete(current);

      const neighbors = this.adjacency[current] || [];
      for (const { node: neighbor, dist } of neighbors) {
        if (unvisited.has(neighbor)) {
          const alt = distances[current] + dist;
          if (alt < distances[neighbor]) {
            distances[neighbor] = alt;
            previous[neighbor] = current;
          }
        }
      }
    }

    // Reconstruct path
    const path = [];
    let curr = targetKey;
    while (curr) {
      path.unshift({ ...this.waypoints[curr], key: curr });
      curr = previous[curr];
    }

    if (path.length > 0 && path[0].key === startKey) {
      return path;
    }
    return [];
  }

  // Determine which office zone a coordinate belongs to
  getRoomForCoord(x, y) {
    if (x <= 496 && y <= 330) return 'pantry';
    if (x >= 504 && y <= 330) return 'war_room';
    if (x <= 496 && y >= 370) return 'dev_cubicles';
    if (x >= 504 && y >= 370) return 'qa_server';
    return 'hallway';
  }

  // Path from freeform coordinates (x, y) to a target waypoint key
  findPathFromCoord(fromX, fromY, targetKey, roomHint = null) {
    if (!this.waypoints[targetKey]) return [];

    const hint = roomHint || this.getRoomForCoord(fromX, fromY);
    const targetWp = this.waypoints[targetKey];

    // If target waypoint already has direct line of sight from current position and is in same room/hallway,
    // head directly to target!
    if (
      (targetWp.room === hint || hint === 'hallway' || targetWp.room === 'hallway') &&
      hasLineOfSight(fromX, fromY, targetWp.x, targetWp.y, 6)
    ) {
      return [{ ...targetWp, key: targetKey }];
    }

    // Otherwise, find the best visible waypoint in current room (or hallway) that minimizes total path distance
    let bestWpKey = null;
    let bestTotalDist = Infinity;

    for (const [key, wp] of Object.entries(this.waypoints)) {
      if (hint && wp.room !== hint && wp.room !== 'hallway') continue;
      
      const distToWp = this.getDistance({ x: fromX, y: fromY }, wp);
      // Check line of sight from character position to candidate waypoint
      if (hasLineOfSight(fromX, fromY, wp.x, wp.y, 6)) {
        const subPath = this.findPath(key, targetKey);
        if (subPath && subPath.length > 0) {
          let pathLen = distToWp;
          for (let i = 0; i < subPath.length - 1; i++) {
            pathLen += this.getDistance(subPath[i], subPath[i + 1]);
          }
          if (pathLen < bestTotalDist) {
            bestTotalDist = pathLen;
            bestWpKey = key;
          }
        }
      }
    }

    // Fallback if no visible waypoint found
    if (!bestWpKey) {
      bestWpKey = this.getNearestWaypoint(fromX, fromY, hint);
    }

    if (!bestWpKey) return [];
    return this.findPath(bestWpKey, targetKey);
  }
}

// Global Pathfinding Engine
const pathfinder = new PathfindingEngine(WAYPOINTS, WAYPOINT_EDGES);

// Sokoban solver entry for sokoban-solver-01-run-20261121.
//
// Strategy: every level is a 1-wide hallway with 1-4 small rooms off it, and a
// box pushed out of a room can never come back, so each room is an independent
// push problem. The program finds the rooms, solves each one push-optimally
// with A* over pushes, and stitches the rooms' move strings together with the
// player's walks between them.
//
// A push state is the boxes' squares plus the player's reachable region (named
// by its lowest square). The heuristic is the cheapest assignment of boxes to
// goals by walking distance, which never overestimates the pushes left, so the
// first solved state A* pops is push-optimal. Dead squares (a box that can
// never be pulled onto a goal again) and frozen 2x2 blocks prune the search.
//
// Determinism: budgets are counted in expanded states, never in wall-clock
// time; every tie is broken by a fixed direction order and an insertion
// counter. Two runs on one set write byte-identical answers.
//
// Local run: MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Work budgets in expanded states, per room. The generator keeps a room only
// when its own push search solves it inside 250,000 states, so A* with the
// assignment heuristic (which expands a fraction of a plain push search) has
// ample headroom; the greedy pass is a safety net that returns any valid
// solution when the optimal search runs out of budget.
const ASTAR_BUDGET = 250_000;
const GREEDY_BUDGET = 150_000;
const WHOLE_BUDGET = 200_000;

const DIRS = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

/** A parsed XSB level: width, walls, goals, boxes and player, all as indices. */
function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const size = w * h;
  const wall = new Uint8Array(size).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outermost frame is wall whatever it shows: nothing leaves the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  goals.sort((a, b) => a - b);
  boxes.sort((a, b) => a - b);
  return { w, h, size, wall, goals, boxes, player };
}

/** Squares a box alone can be pulled onto some goal, by pull-back from the goals. */
function liveSquares(board) {
  const { w, wall, goals, size } = board;
  const live = new Uint8Array(size);
  const queue = goals.slice();
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (let k = 0; k < 4; k++) {
      const d = DIRS[k][1] * w + DIRS[k][0];
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Walking distances from one goal to every floor square (BFS over open floor). */
function goalDistances(board) {
  const { w, wall, goals, size } = board;
  return goals.map((g) => {
    const dist = new Int32Array(size).fill(-1);
    const queue = [g];
    dist[g] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      for (let k = 0; k < 4; k++) {
        const q = p + DIRS[k][1] * w + DIRS[k][0];
        if (!wall[q] && dist[q] < 0) {
          dist[q] = dist[p] + 1;
          queue.push(q);
        }
      }
    }
    return dist;
  });
}

/** All permutations of 0..n-1, in lexicographic order (n <= 5 here). */
function permutations(n) {
  const out = [];
  const a = Array.from({ length: n }, (_, i) => i);
  const gen = (k) => {
    if (k === n) {
      out.push(a.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      const t = a[k];
      a[k] = a[i];
      a[i] = t;
      gen(k + 1);
      const u = a[k];
      a[k] = a[i];
      a[i] = u;
    }
  };
  gen(0);
  return out;
}

/** A binary heap on [f, g, seq, state]: lower f first, deeper g first, older first. */
function makeHeap() {
  const a = [];
  const less = (x, y) =>
    x[0] < y[0] || (x[0] === y[0] && (x[1] > y[1] || (x[1] === y[1] && x[2] < y[2])));
  return {
    get size() {
      return a.length;
    },
    push(e) {
      let i = a.length;
      a.push(e);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(a[i], a[p])) break;
        const t = a[i];
        a[i] = a[p];
        a[p] = t;
        i = p;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length > 0) {
        a[0] = last;
        for (let i = 0; ; ) {
          let c = 2 * i + 1;
          if (c >= a.length) break;
          if (c + 1 < a.length && less(a[c + 1], a[c])) c++;
          if (!less(a[c], a[i])) break;
          const t = a[i];
          a[i] = a[c];
          a[c] = t;
          i = c;
        }
      }
      return top;
    },
  };
}

/**
 * The push-optimal (or, when greedy, any) solution of `board`: its move string
 * in lower LURD letters, or null when the search gives up inside `budget`.
 * A state is the boxes plus the player's reachable region; the search expands
 * pushes only, and the player walks between them when the moves are rebuilt.
 */
function solvePush(board, budget, greedy) {
  const { w, wall, goals, size } = board;
  const n = board.boxes.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(board);
  if (board.boxes.some((b) => !live[b])) return null;
  const distG = goalDistances(board);
  const useAssign = n <= 5;
  const perms = useAssign ? permutations(n) : null;

  // The cheapest assignment of boxes to goals by walking distance: every push
  // moves one box one square, so the true pushes left are never below this.
  const heuristic = (boxes) => {
    if (useAssign) {
      let best = Infinity;
      for (const p of perms) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          const d = distG[p[i]][boxes[i]];
          if (d < 0) {
            s = Infinity;
            break;
          }
          s += d;
        }
        if (s < best) best = s;
      }
      return best;
    }
    let s = 0;
    for (const b of boxes) {
      let m = Infinity;
      for (let gi = 0; gi < n; gi++) {
        const d = distG[gi][b];
        if (d >= 0 && d < m) m = d;
      }
      if (m === Infinity) return Infinity;
      s += m;
    }
    return s;
  };

  // Two stamp arrays so a successor's region never overwrites the region the
  // state being expanded is tested against.
  const seenExp = new Int32Array(size);
  const seenKey = new Int32Array(size);
  const stack = new Int32Array(size);
  let stampExp = 0;
  let stampKey = 0;

  /** The player's reachable region from `from` around walls and boxes: its lowest square and stamp. */
  const region = (occ, from, seen, stamp) => {
    let n = 0;
    stack[n++] = from;
    seen[from] = stamp;
    let low = from;
    while (n > 0) {
      const p = stack[--n];
      if (p < low) low = p;
      for (let k = 0; k < 4; k++) {
        const q = p + DIRS[k][1] * w + DIRS[k][0];
        if (!wall[q] && !occ[q] && seen[q] !== stamp) {
          seen[q] = stamp;
          stack[n++] = q;
        }
      }
    }
    return low;
  };

  /** Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
  const frozenBlock = (occ, t) => {
    for (const a of [t, t - 1, t - w, t - w - 1]) {
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      if (!(wall[a] || occ[a]) || !(wall[b] || occ[b]) || !(wall[c] || occ[c]) || !(wall[d] || occ[d])) continue;
      if ((occ[a] && !goal[a]) || (occ[b] && !goal[b]) || (occ[c] && !goal[c]) || (occ[d] && !goal[d])) return true;
    }
    return false;
  };

  // A state's key: its region's lowest square and the boxes' squares, packed
  // into one number while the board is small enough (rooms hold at most 4
  // boxes), a string otherwise.
  const keyOf = (boxes, low) => {
    if (boxes.length <= 4) {
      let k = low;
      for (const b of boxes) k = k * size + b;
      return k;
    }
    return low + '|' + boxes.join(',');
  };

  /** The shortest walk from `from` to `to` around walls and `boxes`, in lower LURD letters. */
  const walkTo = (from, to, boxes) => {
    if (from === to) return '';
    const occ = new Uint8Array(size);
    for (const b of boxes) occ[b] = 1;
    const prev = new Int32Array(size).fill(-1);
    const how = new Array(size);
    const queue = [from];
    prev[from] = from;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      if (p === to) break;
      for (let k = 0; k < 4; k++) {
        const q = p + DIRS[k][1] * w + DIRS[k][0];
        if (wall[q] || occ[q] || prev[q] !== -1) continue;
        prev[q] = p;
        how[q] = DIRS[k][2];
        queue.push(q);
      }
    }
    if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
    let s = '';
    for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
    return s;
  };

  // The states in the order found: their boxes, the player's square after the
  // push that made them, their region's lowest square, and the push from their
  // parent (the box's old square and the direction).
  const sBoxes = [board.boxes.slice()];
  const sPlayer = [board.player];
  const sLow = [];
  const sParent = [-1];
  const sFrom = [-1];
  const sDir = [-1];
  const sG = [0];
  const occ = new Uint8Array(size);
  for (const b of board.boxes) occ[b] = 1;
  sLow.push(region(occ, board.player, seenKey, ++stampKey));
  for (const b of board.boxes) occ[b] = 0;

  const solved = (boxes) => boxes.every((b) => goal[b]);
  if (solved(board.boxes)) return '';
  const h0 = heuristic(board.boxes);
  if (h0 === Infinity) return null;

  const best = new Map([[keyOf(board.boxes, sLow[0]), 0]]);
  const heap = makeHeap();
  let seq = 0;
  heap.push([greedy ? h0 : h0, 0, seq++, 0]);

  // Rebuild the move string of state `s`: walk to each push's square, then push.
  const reconstruct = (s) => {
    const chain = [];
    for (let t = s; t > 0; t = sParent[t]) chain.push(t);
    chain.reverse();
    let moves = '';
    let player = board.player;
    let boxes = board.boxes.slice();
    for (const t of chain) {
      const from = sFrom[t];
      const k = sDir[t];
      const d = DIRS[k][1] * w + DIRS[k][0];
      moves += walkTo(player, from - d, boxes);
      moves += DIRS[k][2];
      player = from;
      boxes = boxes.slice();
      boxes[boxes.indexOf(from)] = from + d;
      boxes.sort((a, b) => a - b);
    }
    return moves;
  };

  let expanded = 0;
  while (heap.size > 0) {
    const [, g, , s] = heap.pop();
    const boxes = sBoxes[s];
    if (best.get(keyOf(boxes, sLow[s])) !== g) continue; // a cheaper path to this state has since been found
    if (solved(boxes)) return reconstruct(s);
    if (++expanded > budget) return null;
    for (const b of boxes) occ[b] = 1;
    const stamp = ++stampExp;
    region(occ, sPlayer[s], seenExp, stamp);
    for (let bi = 0; bi < n; bi++) {
      const b = boxes[bi];
      for (let k = 0; k < 4; k++) {
        const d = DIRS[k][1] * w + DIRS[k][0];
        const t = b + d;
        if (wall[t] || occ[t] || !live[t]) continue;
        if (seenExp[b - d] !== stamp) continue; // the player cannot stand behind the box
        occ[b] = 0;
        occ[t] = 1;
        let skip = frozenBlock(occ, t);
        let nBoxes = null;
        let nLow = -1;
        let key = null;
        if (!skip) {
          nBoxes = boxes.slice();
          nBoxes[bi] = t;
          nBoxes.sort((x, y) => x - y);
          nLow = region(occ, b, seenKey, ++stampKey);
          key = keyOf(nBoxes, nLow);
          const seenG = best.get(key);
          if (seenG !== undefined && seenG <= g + 1) skip = true;
        }
        occ[t] = 0;
        occ[b] = 1;
        if (skip) continue;
        const ns = sBoxes.length;
        sBoxes.push(nBoxes);
        sPlayer.push(b);
        sLow.push(nLow);
        sParent.push(s);
        sFrom.push(b);
        sDir.push(k);
        sG.push(g + 1);
        best.set(key, g + 1);
        const h = heuristic(nBoxes);
        if (h === Infinity) continue; // no assignment reaches the goals: a dead end
        heap.push([greedy ? h : g + 1 + h, g + 1, seq++, ns]);
      }
    }
    for (const b of boxes) occ[b] = 0;
  }
  return null;
}

/** The square the player stands on after `moves` (lower LURD) from `from`. */
function endOf(w, from, moves) {
  let p = from;
  for (const ch of moves) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway: a
 * box there reaches no goal) out of the floor, and each part left that holds a
 * box is a room. Null when the level is no set of rooms.
 */
function splitRooms(level) {
  const { w, wall, size } = level;
  const live = liveSquares(level);
  const row = Math.floor(level.player / w);
  const cut = new Uint8Array(size);
  for (let x = 0; x < w; x++) {
    const i = row * w + x;
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (level.boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(size).fill(-1);
  const rooms = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (let k = 0; k < 4; k++) {
        const q = squares[i] + DIRS[k][1] * w + DIRS[k][0];
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of level.boxes) {
    if (part[b] < 0) return null;
    rooms[part[b]].boxes.push(b);
  }
  for (const g of level.goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The level's move string: each room solved in turn, the other rooms' boxes standing as walls. */
function solveLevel(text) {
  const level = parseLevel(text);
  const rooms = splitRooms(level);
  if (rooms === null) {
    // No room structure: fall back to one search over the whole level.
    return solvePush(level, WHOLE_BUDGET, false) ?? '';
  }
  let player = level.player;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.boxes) wall[b] = 1;
    }
    const sub = {
      w: level.w,
      h: level.h,
      size: level.size,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    let part = solvePush(sub, ASTAR_BUDGET, false);
    if (part === null) part = solvePush(sub, GREEDY_BUDGET, true);
    if (part === null) return ''; // this room is unsolved: the instance scores 0 either way
    moves += part;
    player = endOf(level.w, player, part);
    room.boxes = room.goals.slice(); // this room's boxes now stand on its goals
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  } catch {
    moves = ''; // an empty answer is valid format and scores 0; never lose the other instances
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}

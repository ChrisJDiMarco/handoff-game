export type Player = 0 | 1;
export type Puck = { id: number; owner: Player; x: number; y: number; vx: number; vy: number };
export type Game = { pucks: Puck[]; player: Player; starter: Player; shots: number; scores: [number, number]; phase: 'ready' | 'moving' | 'handover' | 'over'; fired: number | null; message: string };
export const CENTER = 360, RADIUS = 316, PUCK = 19, ZONE = 103, MAX_SPEED = 10;
export const names = ['Cyan', 'Amber'];
export function createGame(starter: Player = 0): Game {
  return { pucks: Array.from({ length: 7 }, (_, id) => ({ id, owner: ((id % 2 + starter) % 2) as Player, x: CENTER + Math.cos(id * Math.PI * 2 / 7) * 236, y: CENTER + Math.sin(id * Math.PI * 2 / 7) * 236, vx: 0, vy: 0 })), player: starter, starter, shots: 0, scores: [0, 0], phase: 'ready', fired: null, message: 'Shoot a puck. Give it away.' };
}
export const inZone = (p: Puck) => Math.hypot(p.x - CENTER, p.y - CENTER) <= ZONE;
export function launch(game: Game, id: number, dx: number, dy: number): boolean {
  const p = game.pucks.find(p => p.id === id);
  const length = Math.hypot(dx, dy);
  if (game.phase !== 'ready' || !p || p.owner !== game.player || !Number.isFinite(length) || length < 8) return false;
  const speed = Math.min(length / 15, MAX_SPEED);
  p.vx = dx / length * speed; p.vy = dy / length * speed;
  game.fired = id; game.phase = 'moving';
  return true;
}
// Fixed 120 Hz steps. Sub-puck travel per step prevents tunneling at legal power.
export function tick(game: Game): boolean {
  if (game.phase !== 'moving') return false;
  for (const p of game.pucks) { p.x += p.vx; p.y += p.vy; p.vx *= .985; p.vy *= .985; }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < game.pucks.length; i++) for (let j = i + 1; j < game.pucks.length; j++) {
      const a = game.pucks[i], b = game.pucks[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= PUCK * 2) continue;
      const nx = d > 1e-8 ? dx / d : 1, ny = d > 1e-8 ? dy / d : 0;
      const overlap = (PUCK * 2 - d) / 2 + .001;
      a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const impulse = -.95 * relative;
        a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
      }
    }
    for (const p of game.pucks) {
      const dx = p.x - CENTER, dy = p.y - CENTER, d = Math.hypot(dx, dy);
      if (d <= RADIUS - PUCK) continue;
      const nx = dx / d, ny = dy / d;
      p.x = CENTER + nx * (RADIUS - PUCK); p.y = CENTER + ny * (RADIUS - PUCK);
      const outward = p.vx * nx + p.vy * ny;
      if (outward > 0) { p.vx -= 1.82 * outward * nx; p.vy -= 1.82 * outward * ny; }
    }
  }
  if (game.pucks.some(p => Math.hypot(p.vx, p.vy) > .025)) return true;
  for (const p of game.pucks) { p.vx = 0; p.vy = 0; }
  const recipient = (1 - game.player) as Player;
  game.pucks.find(p => p.id === game.fired)!.owner = recipient;
  const gain = game.pucks.filter(p => p.owner === recipient && inZone(p)).length;
  game.scores[recipient] += gain; game.shots++;
  game.message = `${String.fromCharCode(65 + game.fired!)} is now ${names[recipient]}'s. ${names[recipient]} ${gain ? `scores ${gain}` : 'scores 0'}.`;
  game.player = recipient; game.phase = game.shots === 20 ? 'over' : 'handover';
  return false;
}
export function settle(game: Game) { let steps = 0; while (game.phase === 'moving' && steps++ < 2000) tick(game); if (game.phase === 'moving') throw new Error('Shot did not settle'); return steps; }

import type { Entity } from 'typed-adventureland';

type Point = Pick<Entity, 'x' | 'y'>;
type Member = Point & Pick<Character, 'name' | 'ctype' | 'range'>;
interface PositionInput {
  actor: Member;
  target: Point;
  priest: Member | null;
  desiredRange: number;
  distance(point: Point): number;
  canMove(point: Point): boolean;
}

/** Settle at weapon range, then move again only when range or facing changes. */
export function stationaryPosition(input: PositionInput): Point | null {
  const { actor, target, priest, desiredRange, distance, canMove } = input;
  const gap = distance(actor);
  const approaching = gap > actor.range;
  if (actor.ctype === 'priest' && gap <= actor.range) return actor;
  const melee = ['warrior', 'rogue', 'paladin'].includes(actor.ctype);
  const dx = actor.x - target.x, dy = actor.y - target.y;
  const radius = desiredRange + Math.max(0, Math.hypot(dx, dy) - gap);
  const bearing = Math.atan2(dy, dx);
  const priestX = priest ? priest.x - target.x : 0, priestY = priest ? priest.y - target.y : 0;
  const behind = (point: Point) => !melee || !priest || priest.name === actor.name || Math.hypot(priestX, priestY) < 1 ||
    (point.x - target.x) * priestX + (point.y - target.y) * priestY <= 0;
  const tankSpacing = priest ? Math.hypot(actor.x - priest.x, actor.y - priest.y) : Infinity;
  if (Math.abs(gap - desiredRange) <= 3 && gap <= actor.range && behind(actor) &&
      (actor.ctype !== 'mage' || tankSpacing >= 40)) return actor;
  const candidates: { point: Point; score: number[] }[] = [];
  for (let i = 0; i < 32; i++) {
    const angle = bearing + i * Math.PI / 16;
    const point = { x: target.x + Math.cos(angle) * radius, y: target.y + Math.sin(angle) * radius };
    if (!canMove(point)) continue;
    const range = distance(point);
    if (range > actor.range) continue;
    const priestGap = priest ? Math.hypot(point.x - priest.x, point.y - priest.y) : 0;
    const coverage = priest && priest.name !== actor.name ? Math.max(0, priestGap - priest.range + 8) : 0;
    const travel = Math.hypot(point.x - actor.x, point.y - actor.y);
    const positionScore = [Math.max(0, Math.abs(range - desiredRange) - 3), behind(point) ? 0 : 1,
      coverage, actor.ctype === 'mage' && priest ? Math.max(0, 40 - priestGap) : 0];
    // Get a hit in range first. Preferred facing must not send an out-of-range
    // melee fighter around the monster before it can start attacking.
    candidates.push({ point, score: approaching ? [travel, ...positionScore] : [...positionScore, travel] });
  }
  candidates.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) {
      const difference = a.score[i] - b.score[i];
      if (difference) return difference;
    }
    return 0;
  });
  if (candidates[0]) return candidates[0].point;
  // A wall may block the full destination. Advance through a reachable short step.
  const ideal = { x: target.x + Math.cos(bearing) * radius, y: target.y + Math.sin(bearing) * radius };
  const step = Math.min(24, Math.hypot(ideal.x - actor.x, ideal.y - actor.y));
  const direction = Math.atan2(ideal.y - actor.y, ideal.x - actor.x);
  for (const offset of [0, .4, -.4, .8, -.8]) {
    const point = { x: actor.x + Math.cos(direction + offset) * step, y: actor.y + Math.sin(direction + offset) * step };
    if (canMove(point)) return point;
  }
  return null;
}

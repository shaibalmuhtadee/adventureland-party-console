import { blocked, cost, unlocked } from '../skills/eligibility.ts';
import { decision, type Combatant, type CombatContext, type SkillDecision, type SkillWorld } from '../skills/types.ts';

// Farming destinations use the shared navigation protocol's string map IDs.
type Point = Pick<SkillWorld['actor'], 'x' | 'y'> & { map: string };
export interface RogueKnifePositionDiagnostic {
  at: number; visible: number; inRegion: number; inRange: number; maxTargets: number;
  expectedTargets: number; destination: Point; holdUntil: number;
  reason: 'spawn center' | 'waiting for targets' | 'enough targets' | 'better batch' | 'no worthwhile move';
}
interface PositionPorts {
  world(): SkillWorld;
  center(): Point | null;
  contains(point: Point): boolean;
  canMove(point: Point): boolean;
  move(point: Point): boolean;
  cooldownRemaining(): number;
  report(diagnostic: RogueKnifePositionDiagnostic | null): void;
}
export function stationaryCrabFarm(context: Pick<CombatContext, 'farmingScript' | 'farmingFocus'>): boolean {
  return context.farmingScript === 'lone-crab' || context.farmingScript === 'rogue-scatter' &&
    context.farmingFocus?.length === 1 && context.farmingFocus[0] === 'crab';
}
function focused(w: SkillWorld, t: Combatant): boolean {
  return w.context.farmingScript === 'lone-crab' ? t.mtype === 'crab' :
    !!w.context.farmingFocus?.includes(t.mtype);
}
function eligibleTargets(w: SkillWorld): Combatant[] {
  return w.context.monsters.filter(t => focused(w, t) && t.visible !== false &&
    !t.dead && !t.rip && t.hp > w.incoming(t) && w.allowed(t, 'fanofknives') &&
    (!t.immune || w.skills.fanofknives?.pierces_immunity));
}

/** Reposition during cooldown; a ready cast waits at most 250ms for extra targets. */
export function createRogueKnifePositioner(ports: PositionPorts) {
  let region = '', centered = false, planAt = 0;
  let moving: { point: Point; deadline: number; holdUntil: number } | null = null;
  const length = (a: Point, b: Point) => Math.hypot(a.x-b.x, a.y-b.y);
  function reset() { region = ''; centered = false; planAt = 0; moving = null; ports.report(null); }
  function sample(w: SkillWorld, center: Point) {
    const visible = w.context.monsters.filter(t => focused(w, t) &&
      t.visible !== false && !t.dead && t.hp > 0 && w.allowed(t, 'fanofknives'));
    const eligible = eligibleTargets(w), cap = w.skills.fanofknives?.max_targets || 5;
    const range = w.skills.fanofknives?.range || 160;
    const count = (point: Point) => {
      // Preserve combat dimensions and replace real coordinates too: distance()
      // reads those before x/y in the native client.
      const actor = { ...w.actor, x: point.x, y: point.y, real_x: point.x, real_y: point.y };
      return Math.min(cap, eligible.filter(t => distance(actor, t) <= range).length);
    };
    const here = { map: w.actor.map, x: w.actor.x, y: w.actor.y }, current = count(here);
    function report(point: Point, reason: RogueKnifePositionDiagnostic['reason']) {
      ports.report({ at: w.now, visible: visible.length,
        inRegion: visible.filter(t => ports.contains({map:w.actor.map,x:t.x,y:t.y})).length,
        inRange: eligible.filter(t => w.range(t, 'fanofknives')).length, maxTargets: cap,
        expectedTargets: count(point), destination: point, holdUntil: moving?.holdUntil || 0, reason });
    }
    return { center, eligible, cap, range, count, here, current, report };
  }
  return {
    reset,
    held() {
      if (!moving || Date.now() >= moving.holdUntil || !ports.center()) return false;
      const w = ports.world();
      if (stationaryCrabFarm(w.context)) return false;
      return !!w.context.farmingScript &&
        eligibleTargets(w).filter(t => w.range(t, 'fanofknives')).length <= 2;
    },
    tick(): boolean {
      const center = ports.center(), w = ports.world();
      if (!center || !w.context.farmingScript || w.context.mode === 'blocked') { reset(); return false; }
      const key = JSON.stringify([w.context.farmingScript, w.context.farmingFocus, center]);
      if (key !== region) { reset(); region = key; }
      const s = sample(w, center);
      if (stationaryCrabFarm(w.context)) {
        moving = null; planAt = 0;
        s.report(center, 'spawn center'); return ports.move(center);
      }
      if (!centered) {
        centered = length(s.here,center) <= 2;
        s.report(center, 'spawn center'); return ports.move(center);
      }
      if (s.current >= 3) {
        moving = null; s.report(s.here, 'enough targets'); return ports.move(s.here);
      }
      if (moving) {
        if (w.now < moving.deadline && length(s.here, moving.point) > 2 &&
            s.count(moving.point) >= s.current + 2 && ports.contains(moving.point) && ports.canMove(moving.point)) {
          s.report(moving.point, 'better batch'); return ports.move(moving.point);
        }
        moving = null;
      }
      if (w.now < planAt || !unlocked(w, 'fanofknives') || w.actor.mp < cost(w, 'fanofknives')) {
        s.report(s.here, 'no worthwhile move'); return ports.move(s.here);
      }
      planAt = w.now + 500;
      // A trip may use the remaining cooldown plus at most 250ms, and never
      // exceed one second. Wait for fast respawns when no short trip improves it.
      const seconds = Math.min(1, (ports.cooldownRemaining() + 250) / 1000);
      const radius = Math.max(0, w.actor.speed) * seconds;
      let best: Point = s.here;
      let bestCount = s.current, bestDistance = 0;
      const candidates: Point[] = [];
      for (const fraction of [1/3, 2/3, 1]) for (let angle = 0; angle < 16; angle++) {
        const radians = angle * Math.PI / 8;
        candidates.push({ map: center.map, x: s.here.x + Math.cos(radians)*radius*fraction,
          y: s.here.y + Math.sin(radians)*radius*fraction });
      }
      for (const point of candidates) {
        const travel = length(s.here, point);
        if (travel < 2 || !ports.contains(point) || !ports.canMove(point)) continue;
        const count = s.count(point);
        if (count > bestCount || count === bestCount && travel < bestDistance) {
          best = point; bestCount = count; bestDistance = travel;
        }
      }
      if (bestCount >= s.current + 2) {
        moving = { point: best, deadline: w.now + seconds*1000, holdUntil: w.now + Math.min(250, bestDistance/Math.max(1,w.actor.speed)*1000) };
        s.report(best, 'better batch'); return ports.move(best);
      }
      s.report(s.here, s.eligible.length ? 'no worthwhile move' : 'waiting for targets');
      return ports.move(s.here);
    },
  };
}

/** The native skill shares the attack cooldown. Keep every ready cast for the farm. */
export function rogueKnifeAttack(w: SkillWorld): SkillDecision | null {
  const cap = w.skills.fanofknives?.max_targets || 5;
  const targets = eligibleTargets(w).filter(t =>
    !blocked(w, decision('fanofknives', [t])))
    .sort((a, b) => Math.hypot(a.x-w.actor.x,a.y-w.actor.y) -
      Math.hypot(b.x-w.actor.x,b.y-w.actor.y) || a.id.localeCompare(b.id))
    .slice(0, cap);
  return targets.length ? decision('fanofknives', targets, 'damage', 'rogue knife farm') : null;
}

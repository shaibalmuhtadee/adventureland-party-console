import type { Actor, Combatant } from '../skills/types.ts';

type Point = Pick<Actor, 'x' | 'y'> & { map: string };
interface AuraPorts {
  entities(): Record<string, Combatant>;
  width(entity: Actor | Combatant): number;
  height(entity: Actor | Combatant): number;
  canMove(point: Point): boolean;
}

// Server npc_loop: distance(player, npc) < 320, refreshed every two seconds.
const AURA_RANGE = 320;

/** Only owns movement while the buff is absent; never budgets excursions. */
export function createKaneAuraRecovery(ports: AuraPorts) {
  let lastSeen: Combatant | null = null;
  return {
    destination(actor: Actor): Point | null {
      if (lastSeen && (lastSeen.map !== actor.map || lastSeen.in !== actor.in)) lastSeen = null;
      const kane = Object.values(ports.entities()).find(e => 'npc' in e && e.npc === 'citizen0' &&
        e.visible !== false && !e.dead && !e.rip &&
        (!e.map || e.map === actor.map) && (e.in == null || e.in === actor.in));
      if (kane) lastSeen = { ...kane, map: actor.map, in: actor.in,
        x: kane.real_x ?? kane.x, y: kane.real_y ?? kane.y };
      // Remember the trapped NPC if farming takes him outside client visibility.
      const npc = kane || lastSeen;
      const buff = actor.s.citizen0aura;
      if (buff && (buff.ms == null || buff.ms > 0) || !npc) return null;
      const here = {map:actor.map,x:actor.real_x ?? actor.x,y:actor.real_y ?? actor.y};
      if (distance(actor,npc) < AURA_RANGE) return here;
      const x = npc.real_x ?? npc.x, y = npc.real_y ?? npc.y;
      // Native distance uses axis-aligned visual rectangles. Their overlap
      // region, expanded by 320, gives the permissible actor positions.
      const halfWidth = (ports.width(actor)+ports.width(npc))/2;
      const nearest = {x:Math.max(x-halfWidth,Math.min(x+halfWidth,here.x)),
        y:Math.max(y-ports.height(npc),Math.min(y+ports.height(actor),here.y))};
      const dx = here.x-nearest.x, dy = here.y-nearest.y, gap = Math.hypot(dx,dy);
      // One unit inside the strict boundary avoids stopping exactly at 320.
      const ratio = Math.min(1,(AURA_RANGE-1)/Math.max(1,gap));
      const projected = {map:actor.map,x:nearest.x+dx*ratio,y:nearest.y+dy*ratio};
      const reachable = (point: Point) => ports.canMove(point) &&
        distance({...actor,x:point.x,y:point.y,real_x:point.x,real_y:point.y},npc) < AURA_RANGE;
      if (reachable(projected)) return projected;
      // If terrain blocks the shortest entry, choose the shortest directly
      // reachable alternative sampled inside the aura.
      const candidates: Point[] = [{map:actor.map,x,y}];
      for (const radius of [319,239,159,79]) for (let i=0;i<64;i++) {
        const angle = i*Math.PI/32;
        candidates.push({map:actor.map,x:x+Math.cos(angle)*radius,y:y+Math.sin(angle)*radius});
      }
      return candidates.filter(reachable).sort((a,b) =>
        Math.hypot(a.x-here.x,a.y-here.y)-Math.hypot(b.x-here.x,b.y-here.y))[0] || here;
    },
  };
}

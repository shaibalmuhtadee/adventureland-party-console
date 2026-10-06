import { eventPolicy } from '../../../dashboard/lib/event-policy.ts';
import { halloweenPreparation, sameHalloweenSpawn, rankHalloweenBosses, type HalloweenAttendance, type HalloweenAttendanceReport,
  type HalloweenObservation, type HalloweenSpawn } from '../../events/halloween.ts';

interface State {
  leader: string | null;
  followers: Record<string, boolean>;
  merchantCharacter: string | null;
  activeConvoy?: { participants: string[] } | null;
  halloweenAttendance?: Record<string, HalloweenAttendance>;
  statuses: Record<string, { server?: string; seenAt?: number; map?: string; x?: number; y?: number; halloweenDeparturePending?: boolean;
    halloweenObservation?: HalloweenObservation | null } | undefined>;
}
interface Ports {
  now(): number;
  selected(name: string): boolean;
  persist(): void;
}
/** The event-policy source owns the encounter; followers never rank their own feed. */
export function createHalloweenAttendance(state: State, ports: Ports) {
  function freshObservation(source: string, realm: string, name: string, now: number) {
    const reporter = state.statuses[source], observation = reporter?.halloweenObservation;
    if (!observation || now - Number(reporter?.seenAt || 0) > 10000 ||
        now - observation.feedAt > 120000 || observation.feedAt > now + 5000 ||
        state.statuses[name]?.server !== realm) return null;
    return observation;
  }
  function departurePending(source: string, realm: string, now: number): boolean {
    return Object.entries(state.statuses).some(([name, status]) =>
      status?.server === realm && now - Number(status.seenAt || 0) < 10000 &&
      eventPolicy(state, name).source === source && status.halloweenDeparturePending === true);
  }
  function retain(previous: HalloweenAttendance | undefined, observation: HalloweenObservation, now: number) {
    if (previous?.phase !== 'attending') return null;
    const live = observation.bosses.find(boss => boss.type === previous.encounter.type);
    if (!live) return null;
    if (routeReached(previous, now) && (live.map !== previous.encounter.map ||
        Math.hypot(live.x - previous.encounter.x, live.y - previous.encounter.y) > 100)) {
      const updated = { ...previous, encounter: live, generation: previous.generation + 1, lastLiveAt: now };
      state.halloweenAttendance![JSON.stringify([previous.source, previous.realm])] = updated;
      ports.persist();
      return updated;
    }
    // Keep one walking destination for the whole party until the leg completes.
    return { ...previous, encounter: { ...live, map: previous.encounter.map,
      x: previous.encounter.x, y: previous.encounter.y }, lastLiveAt: now };
  }
  function routeReached(previous: Extract<HalloweenAttendance, { phase: 'attending' }>, now: number): boolean {
    if (state.activeConvoy) return false;
    const members = Object.entries(state.statuses).filter(([name, status]) =>
      status?.server === previous.realm && now - Number(status.seenAt || 0) < 10000 &&
      eventPolicy(state, name).source === previous.source && ports.selected(name));
    return members.length > 0 && members.every(([, status]) => status?.map === previous.encounter.map &&
      Math.hypot(Number(status.x) - previous.encounter.x, Number(status.y) - previous.encounter.y) <= 100);
  }
  function choose(name: string, realm: string, observation: HalloweenObservation) {
    const party = state.halloweenAttendance?.[JSON.stringify([state.leader, realm])];
    const preferred = name === state.merchantCharacter && party?.phase === 'attending'
      ? observation.bosses.find(boss => boss.type === party.encounter.type) : undefined;
    return preferred || rankHalloweenBosses(observation.bosses)[0];
  }
  function advance(name: string, previous: HalloweenAttendance | undefined,
    owner: { source: string; realm: string; generation: number }, observation: HalloweenObservation, now: number): HalloweenAttendance {
    if (previous?.phase === 'attending' &&
        (now - previous.lastLiveAt < 10000 || departurePending(owner.source, owner.realm, now)))
      return { ...owner, phase: 'waiting' };
    const encounter = choose(name, owner.realm, observation);
    if (!encounter && previous?.phase !== 'attending') return { ...owner, phase: 'waiting' };
    const generation = owner.generation + 1;
    const attendance: HalloweenAttendance = encounter
      ? { ...owner, generation, phase: 'attending', encounter, lastLiveAt: now }
      : { ...owner, generation, phase: 'waiting' };
    state.halloweenAttendance![JSON.stringify([owner.source, owner.realm])] = attendance;
    ports.persist();
    return attendance;
  }
  function prepare(previous: HalloweenAttendance | undefined,
    owner: {source: string; realm: string; generation: number}, encounter: HalloweenSpawn): HalloweenAttendance {
    if (previous?.phase === 'preparing' && sameHalloweenSpawn(previous.encounter, encounter)) return previous;
    const attendance: HalloweenAttendance = {...owner, generation: owner.generation + 1, phase: 'preparing', encounter};
    state.halloweenAttendance![JSON.stringify([owner.source, owner.realm])] = attendance;
    ports.persist();
    return attendance;
  }
  function spawned(previous: HalloweenAttendance | undefined, observation: HalloweenObservation, now: number): HalloweenAttendance | null {
    if (previous?.phase !== 'preparing') return null;
    const live = observation.bosses.find(boss => boss.type === previous.encounter.type);
    if (!live) return null;
    // Preserve the shared walking destination and generation across the spawn.
    const attendance: HalloweenAttendance = {source: previous.source, realm: previous.realm,
      generation: previous.generation, phase: 'attending', lastLiveAt: now,
      encounter: {...live, map: previous.encounter.map, x: previous.encounter.x, y: previous.encounter.y}};
    state.halloweenAttendance![JSON.stringify([previous.source, previous.realm])] = attendance;
    ports.persist();
    return attendance;
  }
  function response(name: string): HalloweenAttendanceReport {
    const source = eventPolicy(state, name).source, now = ports.now();
    const reporter = state.statuses[source], realm = reporter?.server || '';
    const key = JSON.stringify([source, realm]);
    const store = state.halloweenAttendance ||= {}, previous = store[key];
    const owner = { source, realm, generation: previous?.generation || 0 };
    if (!ports.selected(name)) return { ...owner, phase: 'idle', validUntil: now + 10000 };
    const observation = freshObservation(source, realm, name, now);
    if (!observation)
      return { ...owner, phase: 'waiting', validUntil: now + 10000 };
    const arrival = spawned(previous, observation, now);
    if (arrival) return {...arrival, validUntil: now + 10000};
    const upcoming = halloweenPreparation(observation, now);
    if (upcoming) return {...prepare(previous, owner, upcoming), validUntil: now + 10000};
    const retained = retain(previous, observation, now);
    if (retained) store[key] = retained;
    const attendance = retained || advance(name, previous, owner, observation, now);
    return { ...attendance, validUntil: now + 10000 };
  }
  return { response };
}

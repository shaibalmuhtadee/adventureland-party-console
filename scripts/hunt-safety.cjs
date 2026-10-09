function missionDestination(hunt, resolve) {
  const mission = (hunt.missions || [])[hunt.currentIndex];
  if (mission && mission.target === hunt.target) return mission.destination ||= resolve(hunt.target);
  return resolve(hunt.target);
}
function destinationKey(location) {
  return location && JSON.stringify([location.map, Number(location.x), Number(location.y)]);
}
function acceptArrival(hunt, convoy, body, now) {
  if(hunt?.backup && hunt.stage==='backup-travel' && hunt.convoyId===convoy.id && convoy.purpose==='monster-hunt') {
    hunt.convoyId=null;hunt.stage='backup-farming';return true;
  }
  if (!hunt || hunt.stage !== 'mission-travel' || hunt.convoyId !== convoy.id ||
      convoy.purpose !== 'monster-hunt' || hunt.target !== body.target.mtype) return false;
  if (hunt.encounter?.convoyId === convoy.id) {
    delete hunt.arrivalHandoff;
    hunt.convoyId = null;
    hunt.stage = 'farming';
    hunt.message = 'Fighting encountered ' + hunt.target + '; continuing to hunt area afterward';
    return true;
  }
  hunt.arrivalHandoff = { cycleId: hunt.cycleId, missionIndex: hunt.currentIndex, target: hunt.target,
    convoyId: convoy.id, epoch: convoy.epoch, character: body.character, runtimeId: body.runtimeId,
    revision: Number(body.navigationRevision), destination: destinationKey(convoy.location), at: now };
  hunt.convoyId = null;
  hunt.stage = 'farming';
  return true;
}
function arrivalProtected(hunt, leader, status, intent, destination, now) {
  if (hunt.encounter) return false;
  const h = hunt.arrivalHandoff;
  if (!h) return false;
  const runtimeId = status?.combatSelection?.runtimeId || status?.convoyNavigation?.runtimeId;
  if (h.cycleId !== hunt.cycleId || h.missionIndex !== hunt.currentIndex || h.target !== hunt.target ||
      h.character !== leader || h.revision !== Number(intent.revision) || intent.cancelled || status?.rip ||
      runtimeId && runtimeId !== h.runtimeId || h.destination !== destinationKey(destination) || now-h.at >= 10000) {
    delete hunt.arrivalHandoff;
    return false;
  }
  return true;
}
function deathLoopDeath(s, newReport) {
  // The final death can arrive after the strategy releases ownership at zero XP.
  return !!s.deathLoop || !!(newReport && s.lastDeath?.strategy === 'death-loop');
}
function eventDeath(s, trips, deathAt, newReport) {
  const reported = newReport && s.lastDeath?.eventTrip;
  const known = reported && trips.find(t => t.startedAt === reported.startedAt && t.event === reported.event);
  const during = t => t && deathAt >= t.startedAt && (t.endedAt == null || deathAt <= t.endedAt);
  return !!(trips.some(during) || during(known || reported) ||
    (!newReport && s.joinedEvent) || (newReport && !('eventTrip' in s.lastDeath) && s.joinedEvent));
}
function recordDeaths(hunt, statuses, now) {
  hunt.deathObservations ||= {};
  hunt.deathCount ||= 0;
  const deaths = [];
  for (const name of hunt.participants) {
    const s = statuses[name];
    if (!s || now - s.seenAt > 10000) continue;
    const at = Number(s.lastDeath && s.lastDeath.at) || 0;
    const dead = !!s.rip || s.hp <= 0;
    const previous = hunt.deathObservations[name] || { at: 0, dead: false, countedAt: 0 };
    const newReport = at > previous.at && at >= hunt.startedAt && at > previous.countedAt + 2000;
    if ((!previous.dead && dead) || (!previous.dead && newReport)) {
      const deathAt = newReport ? at : now;
      const trips = hunt.eventTrips?.[name] || [];
      if (!deathLoopDeath(s, newReport) && !eventDeath(s, trips, deathAt, newReport)) {
        delete hunt.arrivalHandoff;
        hunt.deathCount++; deaths.push(name);
      }
      // Consume protected deaths too, including the rip edge before its report arrives.
      previous.countedAt = now;
    }
    previous.at = Math.max(previous.at, at); previous.dead = dead;
    hunt.deathObservations[name] = previous;
  }
  return deaths;
}
function partyFighting(hunt, statuses, now) {
  return hunt.participants.some(name => {
    const s = statuses[name];
    return s && !s.rip && now - s.seenAt < 10000 &&
      ((s.target && s.target.hp > 0 && (!s.combat || s.combat.inRange || s.combat.canAttack ||
        now - Number(s.combat.lastAttackAt || 0) < 3000)) || (s.threats || []).some(t => t.hp > 0));
  });
}
module.exports = { missionDestination, recordDeaths, deathLoopDeath, eventDeath, partyFighting, acceptArrival, arrivalProtected };

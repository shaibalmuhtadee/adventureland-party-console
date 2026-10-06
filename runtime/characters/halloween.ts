import { observeHalloween, readHalloweenAttendance, halloweenPreparation } from '../events/halloween.ts';
Object.assign(globalThis, { partyHalloweenEvents: { observe: observeHalloween,
  readAttendance: readHalloweenAttendance, preparation: halloweenPreparation } });

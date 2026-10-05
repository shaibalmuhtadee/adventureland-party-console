import { observeHalloween, readHalloweenAttendance } from '../events/halloween.ts';
Object.assign(globalThis, { partyHalloweenEvents: { observe: observeHalloween, readAttendance: readHalloweenAttendance } });

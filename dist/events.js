import { EventEmitter } from "node:events";
/** Lets the modules that change things tell live.ts, which broadcasts to the pages watching, without importing it */
export const events = new EventEmitter();
//# sourceMappingURL=events.js.map
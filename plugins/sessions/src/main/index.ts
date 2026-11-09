import path from "node:path";

import { mainHost } from "@kilo-desktop/kernel";

import { createSessionsMainEntry } from "./entry";

export { createSessionsMainEntry } from "./entry";

/** kilo.sessions' main entry, importing origin's sessions once. */
export const sessionsMainEntry = createSessionsMainEntry({
	originDatabase: (sdk) => path.join(mainHost(sdk).storage.dir, "..", "kilo-ui", "data.db"),
});

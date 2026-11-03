import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEV_RELAUNCH_FILE_ENV, takeDevRelaunch } from "./dev-relaunch.js";

// Runs `electron-forge start` and starts it again whenever the app asks to
// relaunch (see dev-relaunch.ts), so Restart works in development.
const FORGE_APP_ARGS = ["--remote-debugging-port=9222"];
const SAFE_MODE_SWITCH = "--safe-mode";
const requestFile = path.join(tmpdir(), `kilo-dev-relaunch-${process.pid}.json`);

let stopping = false;
let child: ReturnType<typeof spawn> | undefined;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		stopping = true;
		child?.kill(signal);
	});
}
process.on("exit", () => rmSync(requestFile, { force: true }));

function start(safeMode: boolean): void {
	rmSync(requestFile, { force: true });
	child = spawn(
		"electron-forge",
		["start", "--", ...FORGE_APP_ARGS, ...(safeMode ? [SAFE_MODE_SWITCH] : [])],
		{
			stdio: "inherit",
			shell: process.platform === "win32",
			env: { ...process.env, [DEV_RELAUNCH_FILE_ENV]: requestFile },
		},
	);
	child.on("exit", (code, signal) => {
		const relaunch = stopping ? undefined : takeDevRelaunch(requestFile);
		if (relaunch) start(relaunch.safeMode);
		else process.exit(code ?? (signal ? 1 : 0));
	});
}

start(false);

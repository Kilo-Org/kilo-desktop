import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEV_RELAUNCH_FILE_ENV, requestDevRelaunch, takeDevRelaunch } from "./dev-relaunch";

describe("relaunching under the dev launcher", () => {
	const dirs: string[] = [];
	const requestFile = () => {
		const dir = mkdtempSync(path.join(tmpdir(), "dev-relaunch-"));
		dirs.push(dir);
		return path.join(dir, "request.json");
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("hands a relaunch, with or without safe mode, to the launcher once", () => {
		const file = requestFile();
		const env = { [DEV_RELAUNCH_FILE_ENV]: file };

		expect(requestDevRelaunch(true, env)).toBe(true);
		expect(takeDevRelaunch(file)).toEqual({ safeMode: true });
		expect(takeDevRelaunch(file)).toBeUndefined();

		requestDevRelaunch(false, env);
		expect(takeDevRelaunch(file)).toEqual({ safeMode: false });
	});

	it("leaves relaunching to Electron when no launcher is waiting", () => {
		expect(requestDevRelaunch(false, {})).toBe(false);
	});

	it("treats an exit without a request as the app quitting", () => {
		expect(takeDevRelaunch(requestFile())).toBeUndefined();
	});
});

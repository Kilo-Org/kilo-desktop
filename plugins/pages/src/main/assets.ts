import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MainHostServices } from "@kilo-desktop/kernel";

import type { PagesUser } from "./identity-bridge.js";

type Env = Readonly<Record<string, string | undefined>>;

function resolveAsset(host: MainHostServices, subpath: string): string | undefined {
	try {
		const candidate = host.assets?.resolve(subpath);
		return candidate && existsSync(candidate) ? candidate : undefined;
	} catch {
		return undefined;
	}
}

function fromEnv(env: Env, name: string): string | undefined {
	const value = env[name]?.trim();
	return value && existsSync(value) ? value : undefined;
}

/** celld: `PAGES_CELLD_PATH` (development), else the copy staged in `resources/celld/`. */
export function defaultCelld(
	host: MainHostServices,
	env: Env = process.env,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	const executable = platform === "win32" ? "celld.exe" : "celld";
	return fromEnv(env, "PAGES_CELLD_PATH") ?? resolveAsset(host, `resources/celld/${executable}`);
}

/** Pages' build: `PAGES_SERVER_DIR` (development), else `resources/pages-server/`; it must hold a receipt. */
export function defaultServerBuild(
	host: MainHostServices,
	env: Env = process.env,
): string | undefined {
	const candidate =
		fromEnv(env, "PAGES_SERVER_DIR") ?? resolveAsset(host, "resources/pages-server");
	return candidate && existsSync(path.join(candidate, "build-receipt.json"))
		? candidate
		: undefined;
}

/** The one person Pages knows on this device, named after the OS account. */
export function localUser(username: () => string = () => os.userInfo().username): PagesUser {
	let name = "";
	try {
		name = username();
	} catch {
		// No account name (some containers); the fallback below names them.
	}
	return { id: "local-user", name: name || "Local User" };
}

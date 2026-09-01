import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HIDDEN_PROVIDER_IDS = new Set(["kilo", "anaconda-local"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function kiloAuthFilePath(
	env: NodeJS.ProcessEnv = process.env,
	home = os.homedir(),
): string {
	const dataHome = (env.XDG_DATA_HOME ?? path.join(home, ".local", "share")).replace(
		/[\r\n]+/g,
		"",
	);
	return path.join(dataHome, "kilo", "auth.json");
}

export function apiKeyFromAuth(data: unknown, providerID: string): string | null {
	if (HIDDEN_PROVIDER_IDS.has(providerID)) return null;
	if (!isRecord(data)) return null;
	const entry = data[providerID];
	if (!isRecord(entry) || entry.type !== "api" || typeof entry.key !== "string") return null;
	const key = entry.key.trim();
	return key.length > 0 ? key : null;
}

export async function readStoredApiKey(
	providerID: string,
	file = kiloAuthFilePath(),
): Promise<string | null> {
	const raw = await readFile(file, "utf8").catch(() => null);
	if (raw === null) return null;
	try {
		return apiKeyFromAuth(JSON.parse(raw), providerID);
	} catch {
		return null;
	}
}

/**
 * Bridge payload resolution — finds the installed npm payload package for the
 * current platform and reads its manifest.
 *
 * The payload is delivered as a platform-specific npm package:
 *   @anaconda/desktop-bridge-payload-<os>-<cpu>
 *
 * Each package contains a `manifest.json` describing the launch contract,
 * native binary inventory, and version metadata.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface BridgePayloadManifest {
	readonly schema: number;
	readonly target: string;
	readonly python_version: string;
	readonly bridge_version: string;
	readonly launch: readonly string[];
	readonly packages: Record<string, string>;
	/**
	 * Native binary inventory (executables and shared objects) relative to the
	 * payload root. Optional: payloads built before the `macho` → `natives`
	 * rename only carry {@link BridgePayloadManifest.macho}. Use
	 * {@link getNativeInventory} rather than reading this field directly.
	 */
	readonly natives?: readonly string[];
	/**
	 * Legacy macOS-only alias for {@link BridgePayloadManifest.natives}.
	 * Current payloads emit both; pre-rename payloads emit only this one.
	 */
	readonly macho?: readonly string[];
}

export interface BridgePayloadInfo {
	/** Absolute path to the payload root directory. */
	readonly payloadRoot: string;
	/** Parsed manifest.json from the payload. */
	readonly manifest: BridgePayloadManifest;
	/** The npm package name that supplied this payload. */
	readonly packageName: string;
}

/**
 * Map from `${platform}-${arch}` to the npm package name that carries
 * the payload for that target. Only targets with published packages are listed.
 */
const PAYLOAD_PACKAGES: Record<string, string> = {
	"darwin-arm64": "@anaconda/desktop-bridge-payload-darwin-arm64",
	"linux-x64": "@anaconda/desktop-bridge-payload-linux-x64",
	"linux-arm64": "@anaconda/desktop-bridge-payload-linux-arm64",
	"win32-x64": "@anaconda/desktop-bridge-payload-win32-x64",
};

export function getPayloadPackageName(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): string | null {
	return PAYLOAD_PACKAGES[`${platform}-${arch}`] ?? null;
}

/**
 * The list of native binaries and shared objects a payload ships, resolved
 * across the `natives` / `macho` field rename. Returns an empty array when the
 * manifest carries neither — callers that need to chmod the inventory should
 * treat that as suspicious rather than normal.
 */
export function getNativeInventory(manifest: BridgePayloadManifest): readonly string[] {
	return manifest.natives ?? manifest.macho ?? [];
}

/**
 * Resolve the installed payload package for the current (or given) platform.
 * Returns null if the package is not installed or the manifest is missing.
 */
export function resolveInstalledPayload(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): BridgePayloadInfo | null {
	const packageName = getPayloadPackageName(platform, arch);
	if (!packageName) return null;

	// Resolve the package first: a resolution failure means "payload not
	// installed for this platform" and is the only case we swallow. Reading /
	// parsing the manifest is done OUTSIDE this guard so a corrupt or
	// unreadable manifest on a supported platform fails loudly instead of
	// masquerading as "not installed".
	const require = createRequire(path.resolve(import.meta.dirname, "../../package.json"));
	let manifestPath: string;
	try {
		manifestPath = require.resolve(`${packageName}/manifest.json`);
	} catch (error) {
		if (isModuleNotFound(error)) return null;
		throw error;
	}

	const payloadRoot = path.dirname(manifestPath);
	const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (!isBridgePayloadManifest(parsed)) {
		throw new Error(
			`Bridge payload manifest from ${packageName} is malformed: ${manifestPath}. ` +
				`Expected schema/target/python_version/bridge_version/launch/packages fields.`,
		);
	}
	return { payloadRoot, manifest: parsed, packageName };
}

/** Node throws these codes when a require target cannot be resolved. */
function isModuleNotFound(error: unknown): boolean {
	const code = (error as { code?: string } | null)?.code;
	return (
		code === "MODULE_NOT_FOUND" ||
		code === "ERR_MODULE_NOT_FOUND" ||
		code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * A plain object with string values. Arrays are excluded deliberately: they are
 * `typeof "object"` and non-null, so a bare `typeof` check would let
 * `"packages": ["numpy"]` satisfy a field declared as `Record<string, string>`.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Runtime shape check for a parsed manifest.json.
 *
 * `JSON.parse` returns `any`, so without this every consumer of
 * {@link BridgePayloadManifest} would be trusting a type assertion over
 * untrusted file content. Validating here keeps the declared interface honest:
 * required fields really are present, and the two optional inventory fields are
 * string arrays when they appear.
 */
export function isBridgePayloadManifest(value: unknown): value is BridgePayloadManifest {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (typeof record["schema"] !== "number") return false;
	if (typeof record["target"] !== "string") return false;
	if (typeof record["python_version"] !== "string") return false;
	if (typeof record["bridge_version"] !== "string") return false;
	if (!isStringArray(record["launch"])) return false;
	if (!isStringRecord(record["packages"])) return false;
	if (record["natives"] !== undefined && !isStringArray(record["natives"])) return false;
	if (record["macho"] !== undefined && !isStringArray(record["macho"])) return false;
	return true;
}

/**
 * Read a staged payload manifest from a given directory.
 * Returns null when the manifest is absent, unparseable, or malformed.
 */
export function readStagedManifest(bridgeDir: string): BridgePayloadManifest | null {
	const manifestPath = path.join(bridgeDir, "manifest.json");
	if (!existsSync(manifestPath)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
		return isBridgePayloadManifest(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The Kilo server line a build ships: v1 (`kilo serve`, `@kilocode/sdk`) or v2
 * (`kilo2`, `@kilocode/client`). Chosen at build time from `KILO_SERVER_LINE`
 * (v1 when unset); one build carries one line.
 *
 * The plugins that talk to the Kilo server have a v2 copy in its own package
 * with the same plugin id (`kilo.core`, `kilo.chat`, `kilo.marketplace`), since
 * the kernel lets only `kilo.core` provide `kilo.core/*`. A v2 build swaps the
 * packages, not the ids: the Vite configs alias each plugin's entry subpaths
 * (`main`, `web`, `plugin.json`) to its v2 package, so the entry maps and the
 * bundled list stay as they are and v1 code doesn't ship in a v2 build.
 * Contracts are not aliased: a v2 copy re-exports its v1 package's contracts
 * until cutover, so every other plugin compiles unchanged.
 *
 * Short-lived by design (ADR-003): cutover deletes the v1 packages and this
 * module. Node-only build helper; the app reads the line from the
 * `KILO_SERVER_LINE` define where it needs it at run time.
 */

export const SERVER_LINES = ["v1", "v2"] as const;
export type ServerLine = (typeof SERVER_LINES)[number];

export const SERVER_LINE_VARIABLE = "KILO_SERVER_LINE";

export type ServerLinePackages = Readonly<Record<string, Readonly<Record<ServerLine, string>>>>;

/**
 * Each v1 package that has a per-line copy, and the package each line ships.
 * A v2 entry names the v1 package until that plugin's v2 copy exists.
 */
export const SERVER_LINE_PACKAGES: ServerLinePackages = {
	"@kilo-desktop/plugin-core": {
		v1: "@kilo-desktop/plugin-core",
		v2: "@kilo-desktop/plugin-core-v2",
	},
	"@kilo-desktop/plugin-chat": {
		v1: "@kilo-desktop/plugin-chat",
		v2: "@kilo-desktop/plugin-chat-v2",
	},
	"@kilo-desktop/plugin-marketplace": {
		v1: "@kilo-desktop/plugin-marketplace",
		v2: "@kilo-desktop/plugin-marketplace",
	},
};

/** Subpaths the app imports to load a plugin; everything else stays on the v1 package. */
const ENTRY_SUBPATHS = ["main", "web", "plugin.json"];

export function serverLineOf(env: Readonly<Record<string, string | undefined>>): ServerLine {
	const value = env[SERVER_LINE_VARIABLE];
	if (value === undefined || value === "") return "v1";
	if ((SERVER_LINES as readonly string[]).includes(value)) return value as ServerLine;
	throw new Error(
		`${SERVER_LINE_VARIABLE}="${value}" is not a Kilo server line; use ${SERVER_LINES.join(" or ")}.`,
	);
}

/** The package a line ships in place of `v1Package` (itself when it has no per-line copy). */
export function serverLinePackage(
	line: ServerLine,
	v1Package: string,
	packages: ServerLinePackages = SERVER_LINE_PACKAGES,
): string {
	return packages[v1Package]?.[line] ?? v1Package;
}

/** Vite `resolve.alias` entries that load each plugin's entries from the line's package. */
export function serverLineAliases(
	line: ServerLine,
	packages: ServerLinePackages = SERVER_LINE_PACKAGES,
): { find: RegExp; replacement: string }[] {
	const subpaths = ENTRY_SUBPATHS.map((subpath) => subpath.replace(".", "\\.")).join("|");
	return Object.entries(packages).flatMap(([v1Package, lines]) => {
		const target = lines[line];
		if (target === v1Package) return [];
		const escaped = v1Package.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
		return [{ find: new RegExp(`^${escaped}/(${subpaths})$`), replacement: `${target}/$1` }];
	});
}

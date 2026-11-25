import { readFile } from "node:fs/promises";

import { parse } from "jsonc-parser";

type Section = Record<string, unknown>;

/**
 * Desktop's Kilo v2 config file, its sections under the names Desktop's config
 * manager uses (`mcp` for `mcp.servers`, `agent`, `command`, `provider`), with
 * any other top-level keys as they are.
 */
export async function readDesktopConfig(file: string): Promise<Record<string, unknown>> {
	const document = parse(await readFile(file, "utf8")) as Record<string, unknown> | undefined;
	if (!document) return {};
	const { mcp, agents, commands, providers, ...rest } = document as {
		mcp?: { servers?: Section };
		agents?: Section;
		commands?: Section;
		providers?: Section;
	};
	return Object.fromEntries(
		Object.entries({
			...rest,
			mcp: mcp?.servers,
			agent: agents,
			command: commands,
			provider: providers,
		}).filter(([, value]) => value !== undefined),
	);
}

/** A v2 config document with Desktop's sections laid out where Kilo reads them. */
export function desktopConfigDocument(sections: {
	readonly mcp?: Section;
	readonly agent?: Section;
	readonly command?: Section;
	readonly provider?: Section;
}): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries({
			mcp: sections.mcp ? { servers: sections.mcp } : undefined,
			agents: sections.agent,
			commands: sections.command,
			providers: sections.provider,
		}).filter(([, value]) => value !== undefined),
	);
}

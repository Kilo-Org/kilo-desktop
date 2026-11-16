import type { McpMarketplaceItem } from "./schemas";

/**
 * The configuration template Kilo will write for `method`. Mirrors Kilo's own
 * resolution (the named method, else the first) so Desktop reviews and binds
 * exactly what Kilo installs.
 */
export function mcpInstallContent(
	item: McpMarketplaceItem,
	method: string | undefined,
): string | undefined {
	if (typeof item.content === "string") return item.content;
	return (item.content.find((entry) => entry.name === method) ?? item.content[0])?.content;
}

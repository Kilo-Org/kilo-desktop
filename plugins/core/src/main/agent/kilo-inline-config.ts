import { pathToFileURL } from "node:url";

interface PermissionRule {
	readonly action: string;
	readonly resource: string;
	readonly effect: "allow" | "ask" | "deny";
}

/**
 * Kilo's built-in shell rules allow these archive commands, yet it never
 * checks where they write: `tar -xf x.tar -C ~/.config/kilo2` can drop a
 * `kilo2.json` that allows every tool, with no prompt. Until the CLI resolves
 * their destinations, Desktop makes them ask.
 *
 * Kilo v2 concatenates permission rules from every config layer and applies
 * the last rule that matches. Inline config loads after the user and project
 * layers (only admin-managed settings come later), so these rules come after
 * the built-in defaults and every user or project `shell` rule. `"tar *"`
 * also matches a bare `tar`.
 * An "always allow" answer to the prompt still takes precedence.
 */
const ARCHIVE_COMMAND_RULES: readonly PermissionRule[] = ["tar", "unzip", "gzip", "gunzip"].map(
	(command) => ({ action: "shell", resource: `${command} *`, effect: "ask" }),
);

/**
 * Desktop's inline Kilo config, passed as `KILO_CONFIG_CONTENT`, in Kilo v2's
 * config keys. Kilo loads it after the global, `KILO2_CONFIG` and project
 * configs, so its values win over theirs.
 *
 * - Pins the embedder origin, so a project `.kilo2/kilo2.json` cannot repoint
 *   it. The chat/model-list origin is steered by `KILO_API_URL`, not pinned
 *   here.
 * - Loads Desktop's managed plugins (see `managed-kilo-plugins.ts`).
 * - Makes archive commands ask (see `ARCHIVE_COMMAND_RULES`).
 */
export function kiloInlineConfigContent(pluginFiles: readonly string[], baseUrl: string): string {
	const config: {
		indexing: { kilo: { baseUrl: string } };
		permissions: readonly PermissionRule[];
		plugins?: string[];
	} = {
		indexing: { kilo: { baseUrl } },
		permissions: ARCHIVE_COMMAND_RULES,
	};
	if (pluginFiles.length > 0) {
		config.plugins = pluginFiles.map((file) => pathToFileURL(file).href);
	}
	return JSON.stringify(config);
}

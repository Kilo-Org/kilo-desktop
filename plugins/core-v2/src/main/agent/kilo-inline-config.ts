import { pathToFileURL } from "node:url";

type PermissionAction = "allow" | "ask" | "deny";

/**
 * Kilo's built-in bash table allows these archive commands, yet it never
 * checks where they write: `tar -xf x.tar -C ~/.config/kilo` can drop a
 * `kilo.json` that allows every tool, with no prompt. Until the
 * CLI resolves their destinations, Desktop makes them ask.
 *
 * The rules sit under `bash*`, not `bash`: Kilo deep-merges inline config, so
 * an object under `bash` would replace a user's scalar `"bash": "allow"`
 * (which Kilo writes for existing users) and drop them back to Kilo's default
 * table. `bash*` is a separate key that still matches the `bash` permission,
 * and Kilo evaluates the last matching rule, so these rules come after the
 * defaults and every user or project `bash` rule. `"tar *"` also matches a
 * bare `tar`. A per-agent `agent.<name>.permission` rule and an "always
 * allow" answer to the prompt still take precedence.
 */
const ARCHIVE_COMMAND_PERMISSION: Readonly<Record<string, Record<string, PermissionAction>>> = {
	"bash*": { "tar *": "ask", "unzip *": "ask", "gzip *": "ask", "gunzip *": "ask" },
};

/**
 * Desktop's inline Kilo config, passed as `KILO_CONFIG_CONTENT`. Kilo
 * deep-merges it after the global, project and `KILO_CONFIG_DIR` configs, so
 * its values win over theirs.
 *
 * - Pins the embedder origin, so a project `.kilo/kilo.json` cannot repoint
 *   it. The chat/model-list origin is steered by `KILO_API_URL`, not pinned
 *   here: the CLI derives those paths from `provider.kilo.options.baseURL` in
 *   a way no single value serves correctly.
 * - Loads Desktop's managed plugins (see `managed-kilo-plugins.ts`).
 * - Makes archive commands ask (see `ARCHIVE_COMMAND_PERMISSION`).
 */
export function kiloInlineConfigContent(pluginFiles: readonly string[], baseUrl: string): string {
	const config: {
		indexing: { kilo: { baseUrl: string } };
		permission: typeof ARCHIVE_COMMAND_PERMISSION;
		plugin?: string[];
	} = {
		indexing: { kilo: { baseUrl } },
		permission: ARCHIVE_COMMAND_PERMISSION,
	};
	if (pluginFiles.length > 0) {
		config.plugin = pluginFiles.map((file) => pathToFileURL(file).href);
	}
	return JSON.stringify(config);
}

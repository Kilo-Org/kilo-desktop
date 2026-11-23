interface PermissionRule {
	readonly action: string;
	readonly resource: string;
	readonly effect: "allow" | "ask" | "deny";
}

/**
 * Kilo's built-in shell rules allow these archive commands, yet never check
 * where they write: `tar -xf x.tar -C ~/.config/kilo2` can drop a
 * `kilo2.json` that allows every tool, with no prompt. Until the CLI resolves
 * their destinations, Desktop makes them ask.
 *
 * Kilo v2 evaluates the last matching rule, and config `permissions` lists
 * from every layer are concatenated with the inline layer last, so these
 * rules come after Kilo's defaults and every user or project `shell` rule
 * without replacing them. `"tar *"` also matches a bare `tar`. A per-agent
 * rule, a session rule and a saved "always allow" answer still take
 * precedence.
 */
const ARCHIVE_COMMANDS_ASK: readonly PermissionRule[] = [
	"tar *",
	"unzip *",
	"gzip *",
	"gunzip *",
].map((resource) => ({ action: "shell", resource, effect: "ask" }));

/**
 * Desktop's inline Kilo v2 config, passed as `KILO_CONFIG_CONTENT`. Kilo
 * reads it after the global, project and `KILO2_CONFIG_DIR` configs.
 *
 * - Makes archive commands ask (see `ARCHIVE_COMMANDS_ASK`).
 * - Pins the Kilo embedder's base URL, so a project's `indexing.kilo.baseUrl`
 *   cannot send the user's Kilo token elsewhere: Kilo merges `indexing` field
 *   by field, the last document winning. The pin is the AI gateway base v2
 *   derives from `kiloApiUrl` (`KILO_API_URL`), so indexing goes where it would
 *   without a project override.
 */
export function kiloInlineConfigContent(kiloApiUrl: string): string {
	const gateway = `${kiloApiUrl.replace(/\/+$/, "")}/api/gateway/v1`;
	return JSON.stringify({
		permissions: ARCHIVE_COMMANDS_ASK,
		indexing: { kilo: { baseUrl: gateway } },
	});
}

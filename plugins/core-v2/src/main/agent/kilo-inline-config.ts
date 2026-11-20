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
 * reads it after the global, project and `KILO2_CONFIG_DIR` configs. It makes
 * archive commands ask (see `ARCHIVE_COMMANDS_ASK`).
 *
 * The Kilo gateway origin needs no pin here: v2 reads it, indexing included,
 * from `KILO_API_URL`, which the server manager sets.
 */
export function kiloInlineConfigContent(): string {
	return JSON.stringify({ permissions: ARCHIVE_COMMANDS_ASK });
}

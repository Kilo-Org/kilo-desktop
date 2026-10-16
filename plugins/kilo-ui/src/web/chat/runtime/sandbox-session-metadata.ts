/**
 * Kilo's per-session sandbox stamp (`packages/opencode/src/kilocode/sandbox/state.ts`
 * upstream). Kilo resolves a session's sandbox from this metadata first, then a
 * saved per-project preference, then the global `sandbox.enabled` config — and
 * persists the result for the session's lifetime.
 *
 * Desktop has no sandbox toggle or indicator yet, so without an explicit stamp a
 * user's CLI/VS Code `sandbox.enabled: true` would silently confine every Desktop
 * session with no way to turn it off (anaconda/agentic-desktop#730). Stamping
 * `enabled: false` keeps Desktop sessions unsandboxed until the app exposes the
 * setting. `version: 0` matches what the VS Code extension stamps on new sessions.
 */
export const SANDBOX_DISABLED_SESSION_METADATA = {
	"kilocode.sandbox": { enabled: false, version: 0 },
} as const;

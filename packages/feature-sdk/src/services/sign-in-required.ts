/**
 * Refusals for agent calls to `requiresSignIn` tools made while the user is
 * signed out. The tool gateway returns them as tool errors; errors reach
 * agents and the chat UI only as text (MCP `isError` content → Kilo tool part),
 * so each carries a machine-readable marker the chat uses to render a sign-in
 * card in place of the tool call.
 */

export const SIGN_IN_REQUIRED_TOOL_ERROR_CODE = "[desktop:sign-in-required]";
export const SIGN_IN_DECLINED_TOOL_ERROR_CODE = "[desktop:sign-in-declined]";

/** Who receives the refusal: the bundled Kilo agent (chat shows a prompt) or an external AI app. */
export type SignInRefusalAudience = "kilo" | "external";

const NO_WORKAROUND =
	"Do not try to get the same result another way, such as running the equivalent command in a shell.";

export function signInRequiredToolMessage(audience: SignInRefusalAudience): string {
	if (audience === "external") {
		return (
			`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} This Kilo Desktop tool needs the user to be signed in ` +
			"to Kilo. Ask them to sign in to Kilo in Kilo Desktop, then retry."
		);
	}
	return (
		`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} The user is not signed in to Kilo, so this tool did not ` +
		"run. Desktop is already asking them in the chat whether to sign in, so do not ask them " +
		"yourself: say briefly that you will continue once they answer, then stop. " +
		`${NO_WORKAROUND} If they sign in, they will ask you to continue: call this tool ` +
		"again. If they decline, these tools are turned off until they sign in. If they sign in " +
		"later, the tools reappear in your tool list: from then on, use them again instead of " +
		"running the equivalent commands yourself."
	);
}

export const SIGN_IN_DECLINED_TOOL_MESSAGE =
	`${SIGN_IN_DECLINED_TOOL_ERROR_CODE} The user chose not to sign in, so this tool and the other ` +
	"Desktop tools that need sign-in are turned off until they sign in. Do not call them while " +
	"they are off. If the user signs in later, the tools reappear in your tool list: from then on, " +
	"use them again instead of running the equivalent commands yourself.";

/** True when a tool result (text or structured) is a sign-in-required refusal. */
export function isSignInRequiredToolResult(result: unknown): boolean {
	return resultText(result).includes(SIGN_IN_REQUIRED_TOOL_ERROR_CODE);
}

/** True when a tool result (text or structured) is a refusal after a declined sign-in. */
export function isSignInDeclinedToolResult(result: unknown): boolean {
	return resultText(result).includes(SIGN_IN_DECLINED_TOOL_ERROR_CODE);
}

function resultText(result: unknown): string {
	if (result === undefined || result === null) return "";
	if (typeof result === "string") return result;
	try {
		return JSON.stringify(result) ?? "";
	} catch {
		return "";
	}
}

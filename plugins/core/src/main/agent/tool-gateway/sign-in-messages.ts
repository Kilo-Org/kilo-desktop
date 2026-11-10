import {
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
} from "../../../contracts";

const NO_WORKAROUND =
	"Do not try to get the same result another way, such as running the equivalent command in a shell.";

/** What a signed-out caller is told: the bundled Kilo agent (the chat prompts) or an external app. */
export function signInRequiredToolMessage(audience: "kilo" | "external"): string {
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

/** What a caller of a withdrawn sign-in tool is told (it stays callable by a stale tool list). */
export const SIGN_IN_DECLINED_TOOL_MESSAGE =
	`${SIGN_IN_DECLINED_TOOL_ERROR_CODE} The user chose not to sign in, so this tool and the related ` +
	"Desktop tools that need sign-in are turned off until they sign in. Do not call them while " +
	"they are off. If the user signs in later, the tools reappear in your tool list: from then on, " +
	"use them again instead of running the equivalent commands yourself.";

/**
 * TEMPORARY test flag — force with `VITE_FEATURE_FLAG_OVERRIDES=force-anaconda-sign-in-gate`.
 * When on, chat-triggered Anaconda sign-in gates always pause on the inline
 * sign-in experience, even for already-authenticated sessions. Remove this
 * module and its call sites once the inline sign-in experience has shipped.
 */
export const FORCE_ANACONDA_SIGN_IN_GATE_FLAG = "force-anaconda-sign-in-gate";

export function isAnacondaSignInGateForced(sdk: {
	featureFlags: { peek(): Record<string, unknown> };
}): boolean {
	return sdk.featureFlags.peek()[FORCE_ANACONDA_SIGN_IN_GATE_FLAG] === true;
}

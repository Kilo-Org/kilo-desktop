/** kilo.core's contributions the specs read where kilo.shell draws no UI. */
export const coreData = {
	/** `kernel/identity-provider` contribution key: the primary account's `source`. */
	identitySource: "kilo.core/kilo-account",
	/** The account `package:e2e` (`VITE_KILO_E2E_AUTH=1`) signs in as. */
	e2eEmail: "e2e@kilo.dev",
	/** Cold CLI starts on CI runners can take well over a minute. */
	serverReadyTimeoutMs: 120_000,
	settleTimeoutMs: 30_000,
} as const;

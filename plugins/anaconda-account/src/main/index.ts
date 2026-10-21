import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import { ANACONDA_ACCOUNT_CHANGED_EVENT, anacondaAccountContract } from "../contracts/schemas.js";

import { AnacondaAccountService, type AnacondaCredentials } from "./AnacondaAccountService.js";

/** Structural mirror of the shell's main-side `auth` capability (the slice used here). */
interface AuthCapabilityLike extends Record<string, unknown> {
	session: AnacondaCredentials;
}

/**
 * Main-process registration for the Anaconda account. The shell owns the
 * Anaconda keyring and site config; this plugin adds the sign-in on top via the
 * shell `auth` capability. Key consumers keep reading the key from that
 * capability and never depend on this plugin.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const { host } = mainSdk;
	const service = new AnacondaAccountService({
		credentials: () => mainSdk.plugins.get<AuthCapabilityLike>("auth")?.session ?? null,
		fetch: (url, init) => mainSdk.net.fetch(url, init),
		openExternal: host ? (url) => host.externalLinks.open(url) : undefined,
		logger: mainSdk.logger,
	});

	mainSdk.channels(anacondaAccountContract).handleAll({
		"session.get": () => service.getSession(),
		"session.refresh": () => service.refresh(),
		login: () => service.login(),
		"login.cancel": async () => {
			service.cancelLogin();
			return undefined;
		},
		logout: () => service.logout(),
	});

	const unsubscribe = service.onChanged((session) =>
		mainSdk.events.emit(ANACONDA_ACCOUNT_CHANGED_EVENT, session),
	);
	mainSdk.onDispose(() => {
		unsubscribe();
		service.dispose();
	});
}

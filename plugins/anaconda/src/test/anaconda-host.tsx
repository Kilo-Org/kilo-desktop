// Test host for kilo.anaconda's window: the real kilo.shell (via
// `renderShell`) with kilo.anaconda's renderer entry, `kilo.anaconda/account`
// answered in main by a stand-in the test drives (main's real entry needs the
// keyring and the browser), and kilo.local-inference under its real manifest
// and definitions, entry-less, so the kernel declares the
// `local-model-catalog` flag the Account panel is behind.
import { expect, vi } from "vitest";
import { page } from "vitest/browser";

import type { DomainObjectProvider, PluginEntry } from "@kilo-desktop/kernel";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { LOCAL_INFERENCE_DEFINITIONS } from "@kilo-desktop/plugin-local-inference/contracts";
import { renderShell, type ShellHost } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import {
	ANACONDA_DEFINITIONS,
	AnacondaAccount,
	LOCAL_MODEL_CATALOG_FLAG,
	type AnacondaAccountResult,
	type AnacondaAccountSession,
} from "../contracts";
import { anacondaWebEntry } from "../web";

export const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { email: "dev@anaconda.com", username: "dev" },
};

export type AccountProvider = DomainObjectProvider<typeof AnacondaAccount>;

export interface AnacondaHostOptions {
	readonly session?: AnacondaAccountSession;
	readonly refresh?: () => Promise<AnacondaAccountSession>;
	readonly signIn?: (provider: AccountProvider) => Promise<AnacondaAccountResult>;
	/** The model catalog flag the panel is behind (on unless set). */
	readonly catalog?: boolean;
}

/** Stands in for kilo.anaconda's main entry: an account the test drives. */
function fakeAccountMain(options: AnacondaHostOptions) {
	let provider: AccountProvider | undefined;
	const setSession = (session: AnacondaAccountSession) =>
		provider!.update((state) => ({ ...state, session }));
	const methods = {
		session: vi.fn(async () => provider!.state.session),
		refresh: vi.fn(options.refresh ?? (async () => provider!.state.session)),
		signIn: vi.fn(async () => {
			if (options.signIn) return options.signIn(provider!);
			setSession(SIGNED_IN);
			return { ok: true as const };
		}),
		cancelSignIn: vi.fn(),
		signOut: vi.fn(async (): Promise<AnacondaAccountResult> => {
			setSession({ status: "anonymous" });
			return { ok: true as const };
		}),
		apiKey: vi.fn(async () => null),
		siteDomain: vi.fn(async () => "anaconda.com"),
	};
	const entry: PluginEntry = {
		activate(sdk) {
			provider = sdk.domainObjects.provide(AnacondaAccount, {
				initialState: { session: options.session ?? { status: "anonymous" }, signingIn: false },
				methods,
			});
		},
	};
	return { entry, methods, provider: () => provider! };
}

/**
 * Boots kilo.shell with kilo.anaconda (and the stand-ins above) and opens
 * Settings → Account. Returns the stand-in account's method mocks.
 */
export async function openAccountPage(options: AnacondaHostOptions = {}) {
	const account = fakeAccountMain(options);
	const host: ShellHost = await renderShell(
		[
			{ manifest: localInferenceManifest, definitions: LOCAL_INFERENCE_DEFINITIONS },
			{
				manifest,
				definitions: ANACONDA_DEFINITIONS,
				main: account.entry,
				web: anacondaWebEntry,
			},
		],
		{ desktop: true, flags: { [LOCAL_MODEL_CATALOG_FLAG]: options.catalog ?? true } },
	);
	window.location.hash = "#/settings/account";
	await expect.element(page.getByTestId("account-page")).toBeInTheDocument();
	return { ...account, host };
}

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { page } from "vitest/browser";

import { KernelShell, type DomainProvider, type PluginEntry } from "@kilo-desktop/kernel";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import { Identity, type IdentityState } from "@kilo-desktop/plugin-account/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Authorization,
} from "@kilo-desktop/plugin-workspaces/contracts";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
} from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { CHAT_DEFINITIONS } from "../contracts";
import { createChatMainEntry, type ChatMainOptions } from "../main/entry";

export const SIGNED_IN: IdentityState = {
	connection: "connected",
	authenticated: true,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

export const SIGNED_OUT: IdentityState = { ...SIGNED_IN, authenticated: false };

/** kilo.account's identity in main, with `signIn` recorded. */
export function fakeAccount(identity: IdentityState, signIn: () => void) {
	const entry: PluginEntry = {
		activate(sdk) {
			sdk.domains.provide(Identity, {
				initialState: identity,
				methods: {
					signIn: () => {
						signIn();
						return { signedIn: false };
					},
				} as never,
			});
		},
	};
	return {
		manifest: {
			manifestVersion: 1,
			id: "kilo.account",
			displayName: "Account",
			version: "1.0.0",
			domains: [{ id: "identity", home: "main" }],
		},
		definitions: { domains: [Identity] },
		main: entry,
	};
}

/** kilo.workspaces in main: `authorize` answers as the test says. */
function fakeWorkspaces(authorize: (path: string) => Authorization) {
	const entry: PluginEntry = {
		activate(sdk) {
			sdk.domains.provide(Workspaces, {
				initialState: { workspaces: [], activeId: null, unavailableFolderIds: [] },
				methods: {
					authorize: ({ path }: { path: string }) => authorize(path),
				} as never,
			});
		},
	};
	return { manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS, entry };
}

/** kilo.shell's navigation in the window: `openSettings` goes to `/settings/<section>`. */
const fakeShell = {
	manifest: {
		manifestVersion: 1,
		id: "kilo.shell",
		displayName: "Shell",
		version: "1.0.0",
		domains: [{ id: "navigation", home: "renderer" }],
	},
	definitions: { domains: [Navigation] },
	entry: {
		activate(sdk) {
			const provider: DomainProvider<typeof Navigation> = sdk.domains.provide(Navigation, {
				initialState: { path: "/", search: {} },
				methods: {
					navigate: ({ path }) => provider.setState({ path, search: {} }),
					openSettings: ({ section }) =>
						provider.setState({ path: `/settings/${section ?? ""}`, search: {} }),
					goHome: () => provider.setState({ path: "/", search: {} }),
				},
			});
		},
	} satisfies PluginEntry,
};

/**
 * Renders `ui` in a kernel pair with kilo.chat's main domains (preferences,
 * gateway models, approval mode), a fake kilo.account and kilo.shell's
 * navigation, without the shell's window around it. `ui` renders as
 * kilo.chat's window half, as it does inside its contributions.
 */
export async function renderInKernel(
	ui: ReactNode,
	options: {
		identity?: IdentityState;
		/** More main-side plugins. */
		plugins?: readonly unknown[];
		/** More window-side plugins, e.g. ones contributing transcript renderers. */
		rendererPlugins?: readonly unknown[];
		chatMain?: ChatMainOptions;
		/** kilo.workspaces' answer to `authorize`; allowed by default. */
		authorize?: (path: string) => Authorization;
	} = {},
) {
	cleanup();
	const signIn = vi.fn();
	const opened: string[] = [];
	const account = fakeAccount(options.identity ?? SIGNED_IN, signIn);
	const workspaces = fakeWorkspaces(options.authorize ?? ((path) => ({ allowed: true, path })));
	const storage = createMemoryStorage("/data/kilo.chat");
	const host = await createTestKernelPair({
		host: createTestHost(),
		main: [
			{ manifest: account.manifest, definitions: account.definitions, entry: account.main },
			workspaces,
			{ manifest, definitions: CHAT_DEFINITIONS, entry: createChatMainEntry(options.chatMain) },
			...((options.plugins ?? []) as never[]),
		],
		renderer: [
			fakeShell,
			{ manifest: account.manifest, definitions: account.definitions },
			{ manifest: workspaces.manifest, definitions: workspaces.definitions },
			// An (empty) window entry: main only takes window calls from plugins that run there.
			{ manifest, definitions: CHAT_DEFINITIONS, entry: { activate: () => {} } },
			...((options.rendererPlugins ?? []) as never[]),
		],
		mainHostServices: () => ({ storage }),
	});
	host.main.kernelSdk.domains.provide(KernelShell, {
		initialState: {},
		methods: {
			openExternal: ({ url }: { url: string }) => {
				opened.push(url);
				return true;
			},
		} as never,
	});
	await host.main.flush();
	const view = render(
		<KernelProvider kernel={host.renderer} as={manifest.id}>
			{ui}
		</KernelProvider>,
	);
	return { ...host, view, signIn, opened, screen: page.elementLocator(view.baseElement) };
}

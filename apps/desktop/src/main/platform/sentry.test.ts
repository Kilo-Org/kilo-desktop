import { describe, expect, it, vi } from "vitest";

const { setUser, init, send } = vi.hoisted(() => ({
	setUser: vi.fn(),
	init: vi.fn(),
	send: vi.fn(async () => ({ statusCode: 200 })),
}));
vi.mock("@sentry/electron/main", () => ({
	setUser,
	init,
	spotlightIntegration: () => ({ name: "Spotlight" }),
	IPCMode: { Classic: 1 },
	makeElectronTransport: () => ({ send, flush: vi.fn() }),
	makeElectronOfflineTransport: (base: unknown) => base,
}));
vi.mock("electron", () => ({ app: { isPackaged: true } }));

/** Runs `initSentry` as a dev (unpackaged) build would, restoring the packaged flag after. */
function initAsDevBuild(preferences: PreferencesStore): void {
	const electronApp = app as { isPackaged: boolean };
	electronApp.isPackaged = false;
	try {
		initSentry(preferences);
	} finally {
		electronApp.isPackaged = true;
	}
}

import type { ElectronMainOptions } from "@sentry/electron/main";

import { app } from "electron";

import { identifySentryUser, initSentry } from "./sentry.js";
import type { SentryEnvelope } from "./sentry-scrub.js";
import type { PreferencesStore } from "./PreferencesStore.js";

// Built at runtime, so no token-shaped literal sits in the source.
const fakeToken = `fake${"TOKEN0".repeat(4)}`;

function fakePreferences(overrides: Partial<PreferencesStore> = {}): PreferencesStore {
	return {
		allowDataCollection: true,
		getInstallationId: () => "install-1",
		...overrides,
	} as PreferencesStore;
}

function initWithPreferences(preferences: PreferencesStore): ElectronMainOptions {
	vi.stubEnv("VITE_SENTRY_DSN", "https://key@sentry.example/1");
	vi.stubGlobal("RELEASE_TRACK", "stable");
	vi.stubGlobal("SENTRY_RELEASE_NAME", "kilo-desktop@1.2.3");
	init.mockClear();
	send.mockClear();
	initSentry(preferences);
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	return init.mock.calls[0]![0] as ElectronMainOptions;
}

/** The consent-gated transport `initSentry` passes to `Sentry.init`, wrapping the mocked base `send`. */
function gatedSend(preferences: PreferencesStore): (envelope: unknown) => PromiseLike<unknown> {
	const { transport } = initWithPreferences(preferences);
	type TransportOptions = Parameters<NonNullable<ElectronMainOptions["transport"]>>[0];
	const gated = transport!({} as TransportOptions);
	return (envelope) => gated.send(envelope as SentryEnvelope);
}

function spanEnvelope(url: string) {
	return [
		{},
		[
			[
				{ type: "span", item_count: 1 },
				{
					items: [
						{ name: `GET ${url}`, attributes: { "url.full": { type: "string", value: url } } },
					],
				},
			],
		],
	];
}

describe("initSentry", () => {
	it("sends reports only while data collection is allowed", async () => {
		let allowDataCollection = true;
		const gated = gatedSend({
			get allowDataCollection() {
				return allowDataCollection;
			},
		} as PreferencesStore);

		await gated("first");
		allowDataCollection = false;
		await gated("second");

		expect(send.mock.calls).toEqual([["first"]]);
	});

	it("redacts OS usernames from streamed spans before sending, including renderer spans that bypass beforeSend", async () => {
		const gated = gatedSend(fakePreferences());

		await gated(spanEnvelope("file:///Users/jane/notebook.ipynb"));

		expect(send.mock.calls).toEqual([[spanEnvelope("file:///Users/<redacted>/notebook.ipynb")]]);
	});

	it.each(["log", "trace_metric"])(
		"redacts OS usernames from %s items, which renderers also forward past main's hooks",
		async (type) => {
			const telemetryEnvelope = (path: string) => [
				{},
				[
					[
						{ type, item_count: 1 },
						{
							items: [
								{ body: `opened ${path}`, attributes: { path: { type: "string", value: path } } },
							],
						},
					],
				],
			];
			const gated = gatedSend(fakePreferences());

			await gated(telemetryEnvelope("/Users/jane/notes.txt"));

			expect(send.mock.calls).toEqual([[telemetryEnvelope("/Users/<redacted>/notes.txt")]]);
		},
	);

	it("drops span envelopes while data collection is off", async () => {
		const gated = gatedSend(fakePreferences({ allowDataCollection: false }));

		await gated(spanEnvelope("file:///Users/jane/x"));

		expect(send).not.toHaveBeenCalled();
	});

	it("reports the build's release, the one the renderer reports and source maps upload under", () => {
		const { release } = initWithPreferences(fakePreferences());

		expect(release).toBe("kilo-desktop@1.2.3");
	});

	it("keeps the restrictive v10 data-collection defaults (no user info, cookies, or bodies)", () => {
		const { dataCollection } = initWithPreferences(fakePreferences());

		expect(dataCollection).toMatchObject({
			userInfo: false,
			cookies: false,
			httpBodies: [],
			genAI: { inputs: false, outputs: false },
			databaseQueryData: false,
			stackFrameVariables: false,
		});
	});

	it("redacts credentials from streamed spans before sending", async () => {
		const gated = gatedSend(fakePreferences());

		await gated(spanEnvelope(`https://api.example.test/v1/models?api_key=${fakeToken}`));

		expect(send.mock.calls).toEqual([
			[spanEnvelope("https://api.example.test/v1/models?api_key=[Filtered]")],
		]);
	});
});

describe("initSentry without a DSN", () => {
	it("stays disabled in a packaged build", () => {
		vi.stubEnv("VITE_SENTRY_DSN", "");
		init.mockClear();

		initSentry(fakePreferences());

		vi.unstubAllEnvs();
		expect(init).not.toHaveBeenCalled();
	});

	it("reports only to the local Spotlight sidecar in a dev build", () => {
		vi.stubEnv("VITE_SENTRY_DSN", "");
		vi.stubGlobal("RELEASE_TRACK", "preview");
		vi.stubGlobal("SENTRY_RELEASE_NAME", "kilo-desktop@1.2.3");
		init.mockClear();

		initAsDevBuild(fakePreferences());

		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		expect(init.mock.calls[0]![0]).toMatchObject({
			dsn: "",
			environment: "development",
			tracesSampleRate: 1.0,
			defaultIntegrations: false,
			integrations: [{ name: "Spotlight" }],
		});
	});
});

describe("initSentry beforeSend", () => {
	it("redacts OS usernames from error events", () => {
		const { beforeSend } = initWithPreferences(fakePreferences());

		const event = beforeSend!(
			{ message: "failed to open /Users/jane/notebook.ipynb" } as Parameters<
				NonNullable<ElectronMainOptions["beforeSend"]>
			>[0],
			{},
		);

		expect(event).toMatchObject({ message: "failed to open /Users/<redacted>/notebook.ipynb" });
	});

	it("redacts credentials from error events", () => {
		const { beforeSend } = initWithPreferences(fakePreferences());

		const event = beforeSend!(
			{
				exception: {
					values: [{ type: "KernelError", value: `server said: Bearer ${fakeToken}` }],
				},
			} as Parameters<NonNullable<ElectronMainOptions["beforeSend"]>>[0],
			{},
		);

		expect(event).toMatchObject({
			exception: { values: [{ value: "server said: Bearer [Filtered]" }] },
		});
	});

	it("redacts credentials from transaction items in the transport", async () => {
		const gated = gatedSend(fakePreferences());
		const transactionEnvelope = (path: string) => [
			{ trace: { transaction: `GET ${path}` } },
			[[{ type: "transaction" }, { type: "transaction", transaction: `GET ${path}` }]],
		];

		await gated(transactionEnvelope(`/v1/models?api_key=${fakeToken}`));

		expect(send.mock.calls).toEqual([[transactionEnvelope("/v1/models?api_key=[Filtered]")]]);
	});
});

describe("initSentry beforeBreadcrumb", () => {
	it("drops console breadcrumbs and redacts credentials in the others", () => {
		const { beforeBreadcrumb } = initWithPreferences(fakePreferences());

		expect(beforeBreadcrumb!({ category: "console", message: "server output" })).toBeNull();
		expect(
			beforeBreadcrumb!({
				category: "electron.net",
				data: { url: `https://api.example.test/v1?token=${fakeToken}` },
			}),
		).toEqual({
			category: "electron.net",
			data: { url: "https://api.example.test/v1?token=[Filtered]" },
		});
	});
});

describe("identifySentryUser", () => {
	it("sets the Sentry user id to the installation id", () => {
		identifySentryUser(fakePreferences());
		expect(setUser).toHaveBeenCalledWith({ id: "install-1" });
	});

	it("identifies the user regardless of the preference because the transport enforces consent", () => {
		identifySentryUser(fakePreferences({ allowDataCollection: false }));
		expect(setUser).toHaveBeenCalledWith({ id: "install-1" });
	});
});

import { describe, expect, it, vi } from "vitest";

const { setUser, init, send } = vi.hoisted(() => ({
	setUser: vi.fn(),
	init: vi.fn(),
	send: vi.fn(async () => ({ statusCode: 200 })),
}));
vi.mock("@sentry/electron/main", () => ({
	setUser,
	init,
	close: vi.fn(),
	IPCMode: { Classic: 1 },
	makeElectronTransport: () => ({ send, flush: vi.fn() }),
	makeElectronOfflineTransport: (base: unknown) => base,
}));
vi.mock("electron", () => ({ app: { isPackaged: true } }));

import type { ElectronMainOptions } from "@sentry/electron/main";

import { identifySentryUser, initSentry } from "./sentry.js";
import type { SentryEnvelope } from "./sentry-scrub.js";
import type { PreferencesStore } from "./PreferencesStore.js";

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

	it("keeps the restrictive v10 data-collection defaults (no user info, cookies, or bodies)", () => {
		const { dataCollection } = initWithPreferences(fakePreferences());

		expect(dataCollection).toMatchObject({
			userInfo: false,
			cookies: false,
			httpBodies: [],
			genAI: { inputs: false, outputs: false },
			databaseQueryData: false,
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

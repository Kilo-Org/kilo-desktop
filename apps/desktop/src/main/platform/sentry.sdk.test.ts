import type * as SentryMain from "@sentry/electron/main";
import type { ElectronMainOptions } from "@sentry/electron/main";
import { describe, expect, it, vi } from "vitest";

// Runs the options `initSentry` builds through the real Sentry SDK and reads the
// serialized envelopes it would send. Only `init` (which needs a live Electron
// app) and the network transport are replaced.
const { captured, bodies } = vi.hoisted(() => ({
	captured: [] as ElectronMainOptions[],
	bodies: [] as string[],
}));
vi.mock("electron", () => ({ app: { isPackaged: true, getAppPath: () => "/opt/kilo/app" } }));
vi.mock("@sentry/electron/main", async (importOriginal) => {
	const sentry = await importOriginal<typeof SentryMain>();
	return {
		...sentry,
		init: (options: ElectronMainOptions) => captured.push(options),
		makeElectronOfflineTransport: (base: unknown) => base,
		makeElectronTransport: (options: Parameters<typeof sentry.createTransport>[0]) =>
			sentry.createTransport(options, async (request) => {
				bodies.push(
					typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
				);
				return { statusCode: 200 };
			}),
	};
});

import {
	addBreadcrumb,
	captureException,
	defaultStackParser,
	getCurrentScope,
	getIsolationScope,
	NodeClient,
	spanStreamingIntegration,
	startSpan,
} from "@sentry/electron/main";

import type { PreferencesStore } from "./PreferencesStore.js";
import { initSentry } from "./sentry.js";

// Built at runtime, so no key-shaped literal sits in the source.
const fakeKey = ["sk", "or", "v1", "FAKE0".repeat(6)].join("-");
const fakeToken = `fake${"TOKEN0".repeat(4)}`;

function startRealClient(): NodeClient {
	vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.example.test/1");
	vi.stubGlobal("RELEASE_TRACK", "stable");
	vi.stubGlobal("SENTRY_RELEASE_NAME", "kilo-desktop@1.2.3");
	initSentry({ allowDataCollection: true } as PreferencesStore);
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	bodies.length = 0;
	getCurrentScope().clearBreadcrumbs();
	getIsolationScope().clearBreadcrumbs();
	const options = captured.at(-1)!;
	const client = new NodeClient({
		...options,
		dsn: options.dsn!,
		transport: options.transport!,
		tracesSampleRate: 1,
		integrations: [spanStreamingIntegration()],
		stackParser: defaultStackParser,
	});
	getCurrentScope().setClient(client);
	client.init();
	return client;
}

/** Each envelope line parsed as JSON; binary items are not sent in these tests. */
function envelopeLines(body: string): unknown[] {
	return body.split("\n").map((line) => JSON.parse(line) as unknown);
}

describe("Sentry envelope from the real SDK", () => {
	it("redacts credentials quoted in a local server's output from an error", async () => {
		const client = startRealClient();
		const serverOutput = [
			`Error: provider "openrouter" rejected options {"apiKey":"${fakeKey}"}`,
			`request failed: Authorization: Bearer ${fakeToken}`,
			// Assembled so no URL with a password sits in the source.
			["mcp env DATABASE_URL=postgres://app", "fake-password@db.example.test:5432/main"].join(":"),
		].join("\n");

		addBreadcrumb({ category: "console", level: "error", message: serverOutput });
		addBreadcrumb({
			category: "fetch",
			type: "http",
			data: { method: "GET", url: `https://api.example.test/v1/models?api_key=${fakeToken}` },
		});
		captureException(
			new Error(`Kilo server exited before becoming ready (code 1).\n${serverOutput}`),
		);
		await client.flush(2000);

		expect(bodies).toHaveLength(1);
		const body = bodies[0]!;
		expect(body).not.toContain("FAKE0");
		expect(body).not.toContain("TOKEN0");
		expect(body).not.toContain("fake-password");

		const [, itemHeader, event] = envelopeLines(body) as [
			unknown,
			{ type: string },
			{
				exception: { values: Array<{ value: string }> };
				breadcrumbs: Array<{ category: string; data?: { url?: string } }>;
			},
		];
		expect(itemHeader).toMatchObject({ type: "event" });
		expect(event.exception.values[0]?.value).toContain(
			"Kilo server exited before becoming ready (code 1).",
		);
		expect(event.exception.values[0]?.value).toContain('{"apiKey":"[Filtered]"}');
		expect(event.breadcrumbs.map((breadcrumb) => breadcrumb.category)).toEqual(["fetch"]);
		expect(event.breadcrumbs[0]?.data?.url).toBe(
			"https://api.example.test/v1/models?api_key=[Filtered]",
		);
	});

	it("keeps a long message whole, so a credential past a short cut is still redacted", async () => {
		const client = startRealClient();
		const prefix = "provider error: ".padEnd(300, ".");

		captureException(new Error(`${prefix} retry with Bearer ${fakeToken}`));
		await client.flush(2000);

		const body = bodies.join("\n");
		expect(body).not.toContain("TOKEN0");
		expect(body).toContain(`${prefix} retry with Bearer [Filtered]`);
	});

	it("redacts credentials from streamed spans and transactions", async () => {
		const client = startRealClient();

		startSpan(
			{
				name: `GET https://api.example.test/v1/models?api_key=${fakeToken}`,
				attributes: { "http.request.header.authorization": `Bearer ${fakeToken}` },
			},
			() => undefined,
		);
		client.captureEvent({
			type: "transaction",
			transaction: `POST https://api.example.test/v1/chat?token=${fakeToken}`,
			start_timestamp: 1,
			timestamp: 2,
			spans: [],
			contexts: { trace: { trace_id: "0".repeat(32), span_id: "1".repeat(16) } },
		});
		await client.flush(2000);

		const body = bodies.join("\n");
		const itemTypes = bodies.flatMap((envelope) =>
			envelopeLines(envelope)
				.filter(
					(line): line is { type: string } =>
						typeof line === "object" && line !== null && "type" in line,
				)
				.map((line) => line.type),
		);
		expect(itemTypes).toEqual(expect.arrayContaining(["span", "transaction"]));
		expect(body).not.toContain("TOKEN0");
		expect(body).toContain("api_key=[Filtered]");
		expect(body).toContain("token=[Filtered]");
	});
});

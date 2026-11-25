import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OpenCode } from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	kilo2Executable,
	STAND_IN_MODEL,
	standInProviderConfig,
	startKilo2,
	startStandInModel,
	type Kilo2,
	type StandInModel,
	type StandInReply,
	type StandInRequest,
} from "@kilo-desktop/plugin-core/testing";

import { eventsByType, normalizeRecording } from "./normalize";
import type { GoldenTurn } from "./golden";

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden-turn.json");

/** The prompt and the scripted model behind the golden turn. */
const GOLDEN_PROMPT = "What do my notes say?";

function goldenReply(request: StandInRequest): StandInReply {
	// kilo2 names the chat with a tools-free request.
	if (!request.tools?.length) return { text: ["Notes summary"] };
	if (request.messages.some((message) => message.role === "tool")) {
		return { text: ["The notes ", "say hello."] };
	}
	return {
		reasoning: ["I should read ", "the notes."],
		text: ["Let me read the file."],
		toolCalls: [{ id: "call_1", name: "read", arguments: { path: "notes.txt" } }],
	};
}

/** Ignored: the server's catalogs and instructions (their hashes change daily). */
const isTurnEvent = (event: { type: string; data?: { sessionID?: unknown } }, sessionID: string) =>
	event.type !== "session.instructions.updated" && event.data?.sessionID === sessionID;

/**
 * Runs the golden turn on the bundled kilo2 against a stand-in model: one
 * prompt, a step with reasoning, text and a `read` tool call, then a step
 * with the answer. Returns it normalized (`normalize.ts`).
 */
async function recordGoldenTurn(): Promise<GoldenTurn> {
	let model: StandInModel | undefined;
	let kilo: Kilo2 | undefined;
	const stream = new AbortController();
	try {
		model = await startStandInModel(goldenReply);
		const baseURL = model.baseURL;
		kilo = await startKilo2({
			before: (home) =>
				writeFile(
					path.join(home, "runtime", "config", "kilo2", "kilo2.jsonc"),
					JSON.stringify(standInProviderConfig(baseURL)),
				),
		});
		const project = path.join(await realpath(kilo.home), "project");
		await mkdir(project);
		await writeFile(path.join(project, "notes.txt"), "hello\n");
		const { connection } = kilo;
		const client = OpenCode.make({
			baseUrl: connection.baseUrl,
			headers: {
				authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}`,
			},
		});
		const events: { type: string; data?: Record<string, unknown> }[] = [];
		void (async () => {
			for await (const event of client.event.subscribe({ signal: stream.signal })) {
				events.push(event as never);
			}
		})().catch(() => undefined);
		await vi.waitFor(() => expect(events[0]?.type).toBe("server.connected"));

		const session = await client.session.create({
			location: { directory: project },
			model: STAND_IN_MODEL,
		});
		await client.session.prompt({ sessionID: session.id, text: GOLDEN_PROMPT });
		await vi.waitFor(
			() =>
				expect(events.map((event) => event.type)).toEqual(
					expect.arrayContaining(["session.execution.succeeded", "session.renamed"]),
				),
			{ timeout: 20_000 },
		);
		const { data: messages } = await client.message.list({
			sessionID: session.id,
			order: "asc",
		});
		return normalizeRecording(
			{
				session: await client.session.get({ sessionID: session.id }),
				events: events
					.filter((event) => isTurnEvent(event, session.id))
					.map(({ type, data }) => ({ type, data })),
				messages,
			},
			project,
		) as GoldenTurn;
	} finally {
		stream.abort();
		await kilo?.stop();
		await model?.stop();
	}
}

/**
 * Guards `golden-turn.json`, the v2 fake's reference: a fresh recording on
 * the bundled kilo2 must match it, so a kilo2 upgrade that changes a turn's
 * events or messages fails here. `KILO_UPDATE_GOLDEN=1` rewrites it.
 */
describe.skipIf(!kilo2Executable)("the golden kilo2 turn", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("matches a fresh recording on the bundled kilo2", async () => {
		const recorded = await recordGoldenTurn();
		if (process.env.KILO_UPDATE_GOLDEN === "1") {
			await writeFile(GOLDEN, `${JSON.stringify(recorded, null, "\t")}\n`);
		}
		const golden = JSON.parse(await readFile(GOLDEN, "utf8")) as GoldenTurn;

		expect(recorded.session).toEqual(golden.session);
		expect(recorded.messages).toEqual(golden.messages);
		expect(eventsByType(recorded.events)).toEqual(eventsByType(golden.events));
	});
});

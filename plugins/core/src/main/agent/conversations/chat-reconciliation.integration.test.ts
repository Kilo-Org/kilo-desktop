import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";

import { Chats } from "../../../contracts";
import { bootAgent, cleanUpAgents } from "../../../test/agent/boot.js";
import {
	kilo2Executable,
	startKilo2,
	startStandInKiloApi,
	type Kilo2,
	type StandInKiloApi,
} from "../../../testing/kilo2.js";
import { createServerClient } from "../server-client.js";
import { createKiloChatClient } from "./kilo-chat-client.js";

const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 20_000 });

/** A chat id from the v1 server, which the v2 server never had. */
const V1_CHAT = "ses_0123456789abcdefV1chatABCD";

/**
 * Stands in for a plugin that keeps chat ids (work sessions, panes, the
 * branch namer): on each full read it drops the ids the server lacks, as
 * kilo.work-sessions and kilo.git do.
 */
function chatHolder(initial: readonly string[]) {
	const held = { ids: [...initial], reads: 0 };
	const registration = testPlugin("acme.holder", {
		manifest: { requires: { "kilo.core/chats": "optional" } },
		entry: {
			activate: (sdk) => {
				sdk.domainObjects.track(Chats, {
					added(chats: DomainObjectHandle<typeof Chats>) {
						chats.on("listed", async () => {
							const listed = chats.getState().chats;
							const unlisted = held.ids.filter((id) => !listed[id]);
							const { missing } = await chats.methods.findMissing({ ids: unlisted });
							held.ids = held.ids.filter((id) => !missing.includes(id));
							held.reads += 1;
						});
					},
					removed() {},
				});
			},
		},
	});
	return { held, registration };
}

describe.skipIf(!kilo2Executable)("reconciling held chat ids with the bundled kilo2", () => {
	let api: StandInKiloApi | undefined;
	let kilo: Kilo2 | undefined;

	afterEach(async () => {
		await cleanUpAgents();
		await kilo?.stop();
		await api?.stop();
		kilo = undefined;
		api = undefined;
	});

	it("drops v1 and deleted chats on the first full read, keeping live chats and subagents", async () => {
		api = await startStandInKiloApi();
		kilo = await startKilo2({ apiUrl: api.url });
		const project = path.join(await realpath(kilo.home), "project");
		await mkdir(project);
		const server = createServerClient(kilo.connection);
		const stamp = { "kilo-desktop": { workspaceId: "w1", workSessionId: "wses_1" } };
		const live = await server.session.create({ location: { directory: project }, metadata: stamp });
		const deleted = await server.session.create({
			location: { directory: project },
			metadata: stamp,
		});
		const subagent = await server.session.create({ parentID: live.id, title: "Subagent" });
		await server.session.remove({ sessionID: deleted.id });
		const { held, registration } = chatHolder([V1_CHAT, live.id, deleted.id, subagent.id]);

		const booted = await bootAgent({
			plugins: [registration],
			agent: { createChatClient: () => createKiloChatClient(kilo!.connection) },
		});
		const chats = booted.kernel.kernelSdk.domainObjects.get(Chats)!;

		await eventually(() => expect(held.reads).toBe(1));
		expect(Object.keys(chats.getState().chats)).toEqual([live.id]);
		expect(held.ids).toEqual([live.id, subagent.id]);

		// A chat removed later is announced as deleted, and is missing from then on.
		const deletedEvents: string[] = [];
		chats.on("deleted", ({ chat }) => deletedEvents.push(chat.id));
		await server.session.remove({ sessionID: live.id });
		await eventually(() => expect(deletedEvents).toEqual([live.id]));
		await expect(chats.methods.findMissing({ ids: [live.id] })).resolves.toEqual({
			missing: [live.id],
		});
	});
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "../../../plugin.json";
import { CHAT_TELEMETRY_EVENTS } from "../../contracts";
import { READING_EVENT_IDS } from "./reading-telemetry";

/** kilo.chat's telemetry events that aren't Reading Mode's. */
const OTHER_EVENTS = ["chat-forked"];

const declared = manifest.contributes.extensions["kernel/telemetry-event"] ?? [];

/** The Reading Mode doc's events that list kilo.chat as a sender, by name. */
function documentedChatEvents(): string[] {
	const doc = readFileSync(
		new URL("../../../../../docs/telemetry/reading-mode.md", import.meta.url),
		"utf8",
	);
	return doc
		.split("\n")
		.map((line) => line.split("|").map((cell) => cell.trim()))
		.filter((cells) => cells.length > 3 && cells[2]!.split(", ").includes("kilo.chat"))
		.map((cells) => cells[1]!);
}

describe("Reading Mode telemetry catalog", () => {
	it("declares exactly the typed Reading Mode events in the manifest and the contracts", () => {
		const reading = declared.map(({ id }) => id).filter((id) => !OTHER_EVENTS.includes(id));

		expect(reading.toSorted()).toEqual([...READING_EVENT_IDS].toSorted());
		expect(
			Object.values(CHAT_TELEMETRY_EVENTS)
				.filter((id) => !OTHER_EVENTS.includes(id))
				.toSorted(),
		).toEqual([...READING_EVENT_IDS].toSorted());
	});

	it("documents every one of them, under its manifest name, with kilo.chat as a sender", () => {
		const names = declared
			.filter(({ id }) => (READING_EVENT_IDS as readonly string[]).includes(id))
			.map(({ name }) => name);

		expect(documentedChatEvents().toSorted()).toEqual(names.toSorted());
	});
});

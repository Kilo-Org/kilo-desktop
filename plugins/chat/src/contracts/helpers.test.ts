import { describe, expect, it } from "vitest";

import {
	Drafts,
	MediaViewers,
	PromptQueues,
	mediaViewerKey,
	needsPerson,
	neverAutoReplied,
	permissionRendererApplies,
	queuePreview,
} from "./index";

describe("permissionRendererApplies", () => {
	it("applies to every request without tools, else to requests from those tools by key", () => {
		expect(permissionRendererApplies({}, {})).toBe(true);
		const tools = ["kilo.anaconda/conda_envs_create"];
		const toolKey = "kilo.anaconda/conda_envs_create";
		expect(permissionRendererApplies({ tools }, { toolKey })).toBe(true);
		expect(permissionRendererApplies({ tools }, { toolKey: "kilo.files/open" })).toBe(false);
		expect(permissionRendererApplies({ tools }, {})).toBe(false);
	});
});

describe("auto-approve policies", () => {
	it("never answers sandbox escalation or protected config, and leaves skill shells to the person", () => {
		expect(neverAutoReplied({ sandboxEscalation: true })).toBe(true);
		expect(neverAutoReplied({ configProtected: true })).toBe(true);
		expect(neverAutoReplied({ skillShell: true })).toBe(false);
		expect(needsPerson({ skillShell: true })).toBe(true);
		expect(needsPerson({})).toBe(false);
	});
});

describe("collections", () => {
	it("look up drafts by work session, queues by chat and viewers by pane", () => {
		const text = { text: "hi" };
		expect(Drafts.lookup!({ drafts: { wses_1: text } }, "wses_1")).toBe(text);
		const queue = { items: [], paused: false, editing: null, sending: false };
		expect(PromptQueues.lookup!({ queues: { ses_a: queue } }, "ses_a")).toBe(queue);
		const key = mediaViewerKey("wses_1", "media:ses_a");
		expect(MediaViewers.lookup!({ viewers: { [key]: { revision: 2 } } }, key)).toEqual({
			revision: 2,
		});
	});
});

describe("queuePreview", () => {
	it("shows the text, else what was attached", () => {
		expect(queuePreview({ text: " Fix it ", attachmentParts: [] })).toBe("Fix it");
		expect(
			queuePreview({
				text: "",
				attachmentParts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AA" }],
			}),
		).toBe("Attachment");
		expect(queuePreview({ text: "", attachmentParts: [] })).toBe("Message");
	});
});

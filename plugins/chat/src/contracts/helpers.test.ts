import { describe, expect, it } from "vitest";

import {
	Drafts,
	MediaViewers,
	PromptQueues,
	mediaViewerKey,
	needsPerson,
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

	it("applies by Kilo action to requests no desktop tool raises", () => {
		const actions = ["notebooks_execute"];
		expect(permissionRendererApplies({ actions }, { action: "notebooks_execute" })).toBe(true);
		expect(permissionRendererApplies({ actions }, { action: "shell" })).toBe(false);
	});
});

describe("auto-approve policies", () => {
	it("leaves interactive requests, sandbox escalation and sensitive browser steps to the person", () => {
		const request = (action: string, metadata: Record<string, unknown> = {}) => ({
			action,
			metadata,
		});
		expect(needsPerson(request("shell", { interactive: true }))).toBe(true);
		expect(needsPerson(request("shell", { sandboxEscalation: true }))).toBe(true);
		expect(needsPerson(request("browser", { browserSensitive: true }))).toBe(true);
		expect(needsPerson(request("sandbox_escalation"))).toBe(true);
		expect(needsPerson(request("browser_sensitive"))).toBe(true);
		expect(needsPerson(request("shell", { interactive: "yes" }))).toBe(false);
		expect(needsPerson(request("shell"))).toBe(false);
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

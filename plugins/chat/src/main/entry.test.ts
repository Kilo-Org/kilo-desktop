import { describe, expect, it } from "vitest";

import { Tool, ToolApproval } from "@kilo-desktop/plugin-core/contracts";

import { AutoApprove, Drafts, HtmlPages, MediaViewers, PromptQueues } from "../contracts";
import { chat, bootChatMain, recordingLogger, settle } from "./test-boot";
import { workSession } from "../test/fake-work-sessions";
import { chatMainEntry } from "./index";

describe("kilo.chat in main", () => {
	it.each([
		["with kilo.core and kilo.work-sessions", false, false],
		["without kilo.core", true, false],
		["without kilo.work-sessions", false, true],
		["alone", true, true],
	])("activates every area cleanly %s", async (_label, withoutCore, withoutWorkSessions) => {
		const { logger, errors } = recordingLogger();
		const { kernel } = await bootChatMain({
			entry: chatMainEntry,
			withoutCore,
			workSessions: withoutWorkSessions
				? null
				: { workSessions: [workSession({ chatIds: ["ses_a"] })] },
			chats: [chat("ses_a", { workSessionId: "wses_1" })],
			logger,
		});
		await settle();

		expect(kernel.pluginState("kilo.chat")).toBe("active");
		const get = kernel.kernelSdk.domainObjects;
		for (const domainObject of [AutoApprove, Drafts, PromptQueues, HtmlPages, MediaViewers]) {
			expect(get.get(domainObject), domainObject.id).not.toBeNull();
		}
		if (!withoutCore) {
			const keys = (point: typeof Tool | typeof ToolApproval) =>
				kernel.kernelSdk.extensions
					.list(point)
					.filter((contribution) => contribution.implementation)
					.map((contribution) => contribution.key);
			expect(keys(Tool)).toContain("kilo.chat/html_render");
			expect(keys(ToolApproval)).toContain("kilo.chat/auto-approve");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(errors).toEqual([]);
		await kernel.stop();
	});
});

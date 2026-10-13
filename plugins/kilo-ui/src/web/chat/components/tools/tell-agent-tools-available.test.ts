import { describe, expect, it, vi } from "vitest";

const prompt = vi.hoisted(() => vi.fn(async (_input: unknown, _options: unknown) => ({})));
const createKiloDirectoryClient = vi.hoisted(() =>
	vi.fn((_connection: unknown, _directory: string) => ({ session: { prompt } })),
);

vi.mock("../../runtime/create-kilo-runtime-client.js", () => ({ createKiloDirectoryClient }));

import { tellAgentToolsAvailable } from "./tell-agent-tools-available.js";

const connection = { baseUrl: "http://127.0.0.1:4321" } as never;

describe("tellAgentToolsAvailable", () => {
	it("adds a hidden, reply-less note to the session saying the tools are back", async () => {
		await tellAgentToolsAvailable({
			connection,
			sessionID: "ses_1",
			directory: "/workspace/project",
			toolsLabel: "Desktop's Python environment tools",
		});

		expect(createKiloDirectoryClient).toHaveBeenCalledWith(connection, "/workspace/project");
		const [input, options] = prompt.mock.calls[0]!;
		expect(options).toEqual({ throwOnError: true });
		expect(input).toMatchObject({
			sessionID: "ses_1",
			noReply: true,
			parts: [{ type: "text", synthetic: true, metadata: { background: true } }],
		});
		const text = (input as { parts: [{ text: string }] }).parts[0].text;
		expect(text).toMatch(/signed in/);
		expect(text).toMatch(/Desktop's Python environment tools are available again/);
		expect(text).toMatch(/instead of running the equivalent commands in a shell/);
	});
});

import { describe, expect, it } from "vitest";

import { agentExtensionSchema } from "../../contracts";
import { agentExtensionOf, staticMcpEntry } from "./contributions";

const extension = (metadata: unknown) => agentExtensionOf(agentExtensionSchema.parse(metadata));

describe("a static MCP server", () => {
	it("becomes a local Kilo MCP entry", () => {
		expect(
			staticMcpEntry({
				command: "/plugins/acme/resources/bin/acme",
				args: ["--root", "/plugins/acme/resources"],
				env: { ACME_HOME: "/plugins/acme/resources/home" },
			}),
		).toEqual({
			entry: {
				type: "local",
				command: ["/plugins/acme/resources/bin/acme", "--root", "/plugins/acme/resources"],
				environment: { ACME_HOME: "/plugins/acme/resources/home" },
			},
		});
	});

	it("is skipped when it names no command or its resources were left unresolved", () => {
		expect(staticMcpEntry({ args: [] })).toEqual({
			problem: "it names no command and implements no source",
		});
		expect(staticMcpEntry({ command: "node", args: [], env: { A: "${resources}/a" } })).toEqual({
			problem: "the host could not resolve ${resources} for its plugin",
		});
	});
});

describe("an agent extension", () => {
	it("as a Kilo plugin or a skill, is installed from its absolute path", () => {
		expect(
			extension({
				type: "kilo-plugin",
				path: "/acme/resources/plugin.js",
				v2Path: "/acme/resources/plugin-v2",
			}),
		).toEqual({ plugin: "/acme/resources/plugin-v2" });
		expect(extension({ type: "skill", path: "/acme/resources/skills/review" })).toEqual({
			skill: "/acme/resources/skills/review",
		});
	});

	it("as a Kilo plugin or a skill, is skipped without a resolved absolute path", () => {
		expect(extension({ type: "skill", path: "${resources}/skills/review" })).toEqual({
			problem: "the host could not resolve ${resources} for its plugin",
		});
		expect(
			extension({ type: "kilo-plugin", path: "/acme/plugin.js", v2Path: "plugin-v2" }),
		).toEqual({
			problem: 'its v2Path must be absolute (start it with "${resources}/")',
		});
		expect(extension({ type: "kilo-plugin", path: "/acme/plugin.js" })).toEqual({
			problem: "it has no Kilo v2 build (v2Path)",
		});
	});

	it("as an agent, becomes a Kilo v2 agent with its prompt as the system prompt", () => {
		expect(
			extension({
				type: "agent",
				description: "Reviews code",
				prompt: "You review code.",
				model: { aiProviderId: "kilo", modelId: "anthropic/claude-sonnet-4" },
			}),
		).toEqual({
			agent: {
				description: "Reviews code",
				system: "You review code.",
				mode: "subagent",
				model: { providerID: "kilo", model: "anthropic/claude-sonnet-4" },
			},
		});
	});

	it("as a command, becomes a Kilo v2 command with only what it sets, run as a subagent for subtask", () => {
		expect(extension({ type: "command", template: "Review $ARGUMENTS" })).toEqual({
			command: { template: "Review $ARGUMENTS" },
		});
		expect(
			extension({
				type: "command",
				template: "Review $ARGUMENTS",
				description: "Review",
				agent: "reviewer",
				model: { aiProviderId: "acme", modelId: "m" },
				subtask: false,
			}),
		).toEqual({
			command: {
				template: "Review $ARGUMENTS",
				description: "Review",
				agent: "reviewer",
				model: { providerID: "acme", model: "m" },
				subagent: false,
			},
		});
	});
});

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
		expect(extension({ type: "kilo-plugin", path: "/acme/resources/plugin.js" })).toEqual({
			plugin: "/acme/resources/plugin.js",
		});
		expect(extension({ type: "skill", path: "/acme/resources/skills/review" })).toEqual({
			skill: "/acme/resources/skills/review",
		});
	});

	it("as a Kilo plugin or a skill, is skipped without a resolved absolute path", () => {
		expect(extension({ type: "skill", path: "${resources}/skills/review" })).toEqual({
			problem: "the host could not resolve ${resources} for its plugin",
		});
		expect(extension({ type: "kilo-plugin", path: "plugin.js" })).toEqual({
			problem: 'its path must be absolute (start it with "${resources}/")',
		});
	});

	it("as an agent, becomes a Kilo agent entry with a provider/model model", () => {
		expect(
			extension({
				type: "agent",
				description: "Reviews code",
				system: "You review code.",
				model: { aiProviderId: "kilo", modelId: "anthropic/claude-sonnet-4" },
			}),
		).toEqual({
			agent: {
				description: "Reviews code",
				system: "You review code.",
				mode: "subagent",
				model: "kilo/anthropic/claude-sonnet-4",
			},
		});
	});

	it("as a command, becomes a Kilo command entry with only what it sets", () => {
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
				subagent: false,
			}),
		).toEqual({
			command: {
				template: "Review $ARGUMENTS",
				description: "Review",
				agent: "reviewer",
				model: "acme/m",
				subagent: false,
			},
		});
	});
});

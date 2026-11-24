/**
 * Kilo writes marketplace MCPs into config without checking that their launch
 * command exists, so a missing runtime (Node.js for `npx`, uv for `uvx`) only
 * surfaces later as a spawn failure. These helpers let Desktop name the
 * missing command up front and translate that failure into an actionable hint.
 *
 * The Fix-in-chat prompt is assembled only from Desktop-owned text and the
 * schema-validated command name; catalog-supplied strings never reach the
 * agent, so a catalog entry cannot inject instructions.
 */

import { mcpRuntime } from "../contracts/index";
import { mcpCommandSchema } from "../contracts/index";

const MISSING_COMMAND_ERRORS = [/Executable not found in \$PATH: "([^"]+)"/, /spawn (\S+) ENOENT/];

/** Bare command a catalog MCP method launches, or `undefined` for remote or unresolvable entries. */
export function mcpLaunchCommand(content: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = (parsed as { command?: unknown }).command;
	const bare = mcpCommandSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
	return bare.success ? bare.data : undefined;
}

/** Command named by a Kilo MCP spawn failure, or `undefined` when the failure has another cause. */
export function missingCommand(error: string): string | undefined {
	for (const pattern of MISSING_COMMAND_ERRORS) {
		const match = pattern.exec(error)?.[1];
		if (!match) continue;
		const bare = mcpCommandSchema.safeParse(commandName(match));
		if (bare.success) return bare.data;
	}
	return undefined;
}

export function installAdvice(command: string): string {
	return `Install ${mcpRuntime(command)?.name ?? "it"}, then restart Kilo Desktop.`;
}

export function missingCommandMessage(command: string): string {
	return `${command} was not found. ${installAdvice(command)}`;
}

export function fixMissingCommandPrompt(command: string): string {
	const runtime = mcpRuntime(command)?.name;
	return [
		`Kilo Desktop can't find the \`${command}\` command, so MCP servers that need ${runtime ?? "it"} can't start.`,
		"",
		runtime
			? `Help me install ${runtime} on this computer:`
			: `Help me find and install the program that provides \`${command}\` on this computer:`,
		`1. Check my operating system and whether ${runtime ? `${runtime} or ` : ""}a package manager (such as Homebrew or winget) is already installed.`,
		"2. Recommend the official way to install it here, and explain each command before running it.",
		`3. Confirm \`${command}\` works in a new terminal, then remind me to restart Kilo Desktop so it picks up the new PATH.`,
	].join("\n");
}

function commandName(executable: string): string {
	const base = executable.split(/[/\\]/).pop() ?? executable;
	return base.replace(/\.(exe|cmd|bat)$/i, "");
}

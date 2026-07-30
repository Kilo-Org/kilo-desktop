import type { Command, CommandDefinition } from "../types/sdk.js";

/**
 * In-memory command registry backing `sdk.commands`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.commands.register`, which delegates here. The shell's command
 * palette UI consumes all()/execute().
 *
 * Command ids are auto-namespaced "featureId.commandId". Duplicate
 * registration warns and replaces.
 */
export class CommandRegistry {
	private commands = new Map<string, Command>();

	/** Register a command. Returns an unregister function. */
	register(featureId: string, definition: CommandDefinition): () => void {
		const fullId = `${featureId}.${definition.id}`;
		if (this.commands.has(fullId)) {
			console.warn(`[CommandRegistry] Command "${fullId}" registered twice — replacing.`);
		}
		this.commands.set(fullId, {
			id: fullId,
			featureId,
			label: definition.label,
			handler: definition.handler,
		});
		return () => {
			this.commands.delete(fullId);
		};
	}

	all(): Command[] {
		return Array.from(this.commands.values());
	}

	async execute(fullId: string): Promise<void> {
		const command = this.commands.get(fullId);
		if (!command) {
			throw new Error(`Command not found: ${fullId}`);
		}
		await command.handler();
	}

	removeFeature(featureId: string): void {
		for (const [id, cmd] of this.commands) {
			if (cmd.featureId === featureId) {
				this.commands.delete(id);
			}
		}
	}
}

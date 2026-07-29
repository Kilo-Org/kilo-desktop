import type { Command, CommandDefinition } from "../types/sdk.js";

/**
 * In-memory command registry.
 * Commands are auto-namespaced: "featureId.commandId".
 */
export class CommandRegistry {
	private commands = new Map<string, Command>();

	register(featureId: string, definition: CommandDefinition): void {
		const fullId = `${featureId}.${definition.id}`;
		this.commands.set(fullId, {
			id: fullId,
			featureId,
			label: definition.label,
			handler: definition.handler,
		});
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

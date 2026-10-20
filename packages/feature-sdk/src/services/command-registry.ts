import type { Command, CommandDefinition } from "../types/sdk.js";

/**
 * In-memory command registry backing `sdk.commands`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.commands.register`, which delegates here. The shell's shortcut host
 * and shortcut list consume it.
 *
 * Command ids are auto-namespaced "featureId.commandId". Duplicate
 * registration warns and replaces; the replaced registration's unregister
 * becomes a no-op so a late cleanup can't delete its successor.
 */
export class CommandRegistry {
	private commands = new Map<string, Command>();
	private listeners = new Set<() => void>();

	/** Register a command. Returns an unregister function. */
	register(featureId: string, definition: CommandDefinition): () => void {
		const fullId = `${featureId}.${definition.id}`;
		if (this.commands.has(fullId)) {
			console.warn(`[CommandRegistry] Command "${fullId}" registered twice — replacing.`);
		}
		const command: Command = { ...definition, id: fullId, featureId };
		this.commands.set(fullId, command);
		this.notify();
		return () => {
			if (this.commands.get(fullId) !== command) return;
			this.commands.delete(fullId);
			this.notify();
		};
	}

	all(): Command[] {
		return Array.from(this.commands.values());
	}

	get(fullId: string): Command | undefined {
		return this.commands.get(fullId);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async execute(fullId: string): Promise<void> {
		const command = this.commands.get(fullId);
		if (!command) {
			throw new Error(`Command not found: ${fullId}`);
		}
		await command.handler();
	}

	removeFeature(featureId: string): void {
		let removed = false;
		for (const [id, cmd] of this.commands) {
			if (cmd.featureId === featureId) {
				this.commands.delete(id);
				removed = true;
			}
		}
		if (removed) this.notify();
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.warn("[CommandRegistry] Listener threw:", error);
			}
		}
	}
}

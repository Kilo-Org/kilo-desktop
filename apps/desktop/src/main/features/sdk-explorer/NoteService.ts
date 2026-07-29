import type { Note } from "@anaconda-agentic-desktop/contracts";

/**
 * Simple in-memory note store for SDK exploration.
 * No persistence — keeps things minimal.
 */
export class NoteService {
	private notes: Note[] = [];

	list(): Note[] {
		return [...this.notes];
	}

	add(text: string): Note {
		const note: Note = {
			id: crypto.randomUUID(),
			text,
			createdAt: Date.now(),
		};
		this.notes.push(note);
		return note;
	}

	delete(id: string): { deleted: boolean } {
		const before = this.notes.length;
		this.notes = this.notes.filter((n) => n.id !== id);
		return { deleted: this.notes.length < before };
	}

	clear(): { count: number } {
		const count = this.notes.length;
		this.notes = [];
		return { count };
	}

	echo(message: string): { echoed: string; timestamp: number } {
		return { echoed: `[sdk-explorer] ${message}`, timestamp: Date.now() };
	}
}

import type {
	HostMessagePort,
	ToolCatalogConsumerMessage,
	ToolDescriptor,
} from "@kilo-desktop/feature-sdk";

type MessageListener = (event: { data: unknown }) => void;
type CloseListener = () => void;

/**
 * The main-process end of a renderer tool-catalog port, paired with helpers
 * that play the renderer: publish snapshots, answer calls, close the port.
 */
export class FakeToolProducer {
	readonly sent: ToolCatalogConsumerMessage[] = [];
	readonly port: HostMessagePort;
	#messageListeners = new Set<MessageListener>();
	#closeListeners = new Set<CloseListener>();
	#started = false;
	#queued: unknown[] = [];
	#revision = 0;
	closedByMain = false;
	/** When set, answers every call automatically. */
	respond: ((call: Extract<ToolCatalogConsumerMessage, { type: "call" }>) => unknown) | undefined;

	constructor() {
		const listeners = { message: this.#messageListeners, close: this.#closeListeners };
		const port = {
			postMessage: (message: unknown) => {
				const typed = message as ToolCatalogConsumerMessage;
				this.sent.push(typed);
				if (typed.type === "call" && this.respond) {
					const call = typed;
					queueMicrotask(() => {
						try {
							this.resolve(call.id, this.respond!(call));
						} catch (error) {
							this.reject(call.id, error instanceof Error ? error.message : String(error));
						}
					});
				}
			},
			on: (event: "message" | "close", listener: MessageListener & CloseListener) => {
				listeners[event].add(listener);
				return port;
			},
			off: (event: "message" | "close", listener: MessageListener & CloseListener) => {
				listeners[event].delete(listener);
				return port;
			},
			start: () => {
				this.#started = true;
				for (const data of this.#queued.splice(0)) this.#deliver(data);
			},
			close: () => {
				this.closedByMain = true;
			},
		};
		this.port = port as HostMessagePort;
	}

	/** Raw message from the renderer, delivered once the port is started. */
	send(data: unknown): void {
		if (!this.#started) {
			this.#queued.push(data);
			return;
		}
		this.#deliver(data);
	}

	publish(tools: readonly unknown[], revision = ++this.#revision): void {
		this.send({ type: "catalog", revision, tools });
	}

	resolve(id: string, result: unknown): void {
		this.send({ type: "result", id, ok: true, result });
	}

	reject(id: string, message: string): void {
		this.send({ type: "result", id, ok: false, error: { message } });
	}

	calls(): Extract<ToolCatalogConsumerMessage, { type: "call" }>[] {
		return this.sent.filter(
			(message): message is Extract<ToolCatalogConsumerMessage, { type: "call" }> =>
				message.type === "call",
		);
	}

	/** The renderer went away (reload, crash, window closed). */
	disconnect(): void {
		for (const listener of [...this.#closeListeners]) listener();
	}

	#deliver(data: unknown): void {
		for (const listener of [...this.#messageListeners]) listener({ data });
	}
}

export function descriptor(name: string, overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
	return {
		name,
		description: `${name} tool`,
		inputSchema: { type: "object", properties: { text: { type: "string" } } },
		...overrides,
	};
}

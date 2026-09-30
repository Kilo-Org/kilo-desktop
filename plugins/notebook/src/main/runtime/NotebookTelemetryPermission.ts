/**
 * One plugin-owned permission owner aggregates connected notebooks. Eager daemon
 * startup is not activity. The runtime owns leases and never regrants on restart.
 *
 * Reconciliation serializes acknowledged operations. Withdrawal immediately calls
 * runtime close to fence queued grants; a late open is closed before settling.
 * Flag reads fail closed while pending and only the latest read may enable use.
 * Failed handles are discarded, never retried by already queued activity. Only a
 * new explicit reconciliation may recover with current permission. Failed close
 * acknowledgements propagate; remote revocation may depend on lease expiry.
 */
export interface TelemetryRegistration {
	updatePermission(allowed: boolean): Promise<void>;
	close(): Promise<void>;
}

export type OpenTelemetryRegistration = (options: {
	socketPath: string;
	hostId: string;
	source: "app" | "mcp";
	allowed?: boolean;
}) => Promise<TelemetryRegistration | null>;

interface NotebookTelemetryPermissionOptions {
	socketPath: string;
	openRegistration: OpenTelemetryRegistration;
	readFeatureFlag: () => unknown;
}

export class NotebookTelemetryPermission {
	readonly #options: NotebookTelemetryPermissionOptions;
	readonly #active = new Set<string>();
	#allowed = false;
	#enabled = false;
	#disposed = false;
	#epoch = 0;
	#flagRead = 0;
	#handle: TelemetryRegistration | null = null;
	#handleEpoch = 0;
	#closing: Promise<void> | undefined;
	#failure: { error: unknown } | undefined;
	#pending: Promise<void> = Promise.resolve();

	constructor(options: NotebookTelemetryPermissionOptions) {
		this.#options = options;
	}

	setAllowed(allowed: boolean): Promise<void> {
		this.#allowed = allowed === true;
		if (!this.#allowed) this.#invalidate();
		return this.#enqueue();
	}

	setNotebookActive(notebookId: string, active: boolean): Promise<void> {
		if (active && !this.#disposed) this.#active.add(notebookId);
		else this.#active.delete(notebookId);
		if (this.#active.size === 0) this.#invalidate();
		return this.#enqueue();
	}

	async refreshFeatureFlag(): Promise<void> {
		if (this.#disposed) return;
		const read = ++this.#flagRead;
		this.#enabled = false;
		this.#invalidate();
		const revoke = this.#enqueue();
		const flag = Promise.resolve().then(() => this.#options.readFeatureFlag());
		const [revoked, evaluated] = await Promise.allSettled([revoke, flag]);
		if (revoked.status === "rejected") throw revoked.reason;
		if (evaluated.status === "rejected") throw evaluated.reason;
		if (this.#disposed || read !== this.#flagRead) return;
		this.#enabled = evaluated.value === true;
		await this.#enqueue();
	}

	dispose(): Promise<void> {
		this.#disposed = true;
		this.#active.clear();
		this.#invalidate();
		this.#flagRead++;
		return this.#enqueue();
	}

	#eligible(): boolean {
		return !this.#disposed && this.#enabled && this.#allowed && this.#active.size > 0;
	}

	#invalidate(): void {
		this.#epoch++;
		this.#startClose();
	}

	#startClose(): void {
		if (!this.#handle || this.#closing) return;
		try {
			this.#closing = this.#handle.close();
		} catch (error) {
			this.#closing = Promise.reject(error);
		}
		// Reconciliation consumes this rejection after any in-flight grant settles.
		void this.#closing.catch(() => undefined);
	}

	#enqueue(): Promise<void> {
		const epoch = this.#epoch;
		const failure = this.#failure;
		const next = this.#pending
			.then(() => {
				if (this.#failure !== failure) throw this.#failure?.error;
				return this.#reconcile(epoch);
			})
			.catch((error: unknown) => {
				this.#epoch++;
				this.#failure = { error };
				throw error;
			});
		this.#pending = next.catch(() => undefined);
		return next;
	}

	async #close(): Promise<void> {
		if (!this.#handle) return;
		this.#startClose();
		try {
			await this.#closing;
		} finally {
			this.#handle = null;
			this.#closing = undefined;
		}
	}

	async #reconcile(epoch: number): Promise<void> {
		if (this.#handle && (this.#handleEpoch !== this.#epoch || !this.#eligible())) {
			await this.#close();
		}
		if (epoch !== this.#epoch || !this.#eligible()) return;
		if (!this.#handle) {
			this.#handle = await this.#options.openRegistration({
				socketPath: this.#options.socketPath,
				hostId: "kilo-desktop",
				source: "app",
				allowed: false,
			});
			this.#handleEpoch = epoch;
		}
		if (!this.#handle) return;
		if (epoch !== this.#epoch || !this.#eligible()) {
			await this.#close();
			return;
		}
		try {
			await this.#handle.updatePermission(true);
		} catch (error) {
			await this.#close();
			if (epoch !== this.#epoch || !this.#eligible()) return;
			throw error;
		}
		if (epoch !== this.#epoch || !this.#eligible()) await this.#close();
	}
}

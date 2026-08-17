/**
 * Types and test-time stubs for `@runtimed/node/relay`.
 * Copied from nteract `packages/runtimed-node` at NTERACT_NOTEBOOK_SOURCE.commit
 * so `tsc` and Vitest resolve the module without a prior notebook UI checkout.
 */
export type RuntimeKind = "python" | "deno" | (string & {});
export type PackageManager = "uv" | "conda" | "pixi";
export type CreateNotebookEnvironmentMode = "auto" | "project" | "notebook";

export type CommentsNotebookRef =
	| { kind: "hosted_room"; room_locator: string }
	| { kind: "local_path"; canonical_path: string }
	| { kind: "local_room"; room_id: string };

export interface CreateRelayOptions {
	runtime?: RuntimeKind;
	workingDir?: string;
	socketPath?: string;
	notebookId?: string;
	peerLabel?: string;
	description?: string;
	ephemeral?: boolean;
	dependencies?: string[];
	packageManager?: PackageManager;
	environmentMode?: CreateNotebookEnvironmentMode;
}

export interface OpenRelayOptions {
	socketPath?: string;
	peerLabel?: string;
	description?: string;
}

export interface QueryDaemonOptions {
	socketPath?: string;
}

export interface DaemonInfo {
	version: string;
	socketPath: string;
	isDevMode: boolean;
	blobPort?: number;
}

export interface RelayInfo {
	notebookId: string;
	cellCount?: number;
	needsTrustApproval?: boolean;
	ephemeral?: boolean;
	notebookPath?: string;
	runtime?: string;
	actorLabel?: string;
	connectionScope?: string;
	commentsDocId?: string;
	commentsNotebookRef: CommentsNotebookRef | null;
	protocol: string;
	protocolVersion?: number;
	/** Exact notebook-handshake identity; never filled from a later pool query. */
	daemonVersion?: string;
	socketPath: string;
	blobPort?: number;
	isDevMode: boolean;
}

export type RelayFrame = Buffer | Uint8Array | DataView | ArrayBuffer;

/**
 * Native, host-neutral byte pipe for one browser/WASM notebook peer.
 * Frames include the one-byte typed-frame discriminator and no length prefix.
 */
export class RelaySession {
	readonly notebookId!: string;
	readonly info!: RelayInfo;
	readonly closed!: boolean;
	send(_frame: RelayFrame): Promise<void> {
		return Promise.reject(
			new Error("@runtimed/node relay is provided by the nteract source build"),
		);
	}
	onFrame(_listener: (frame: Buffer) => void): () => void {
		throw new Error("@runtimed/node relay is provided by the nteract source build");
	}
	onClose(_listener: () => void): () => void {
		throw new Error("@runtimed/node relay is provided by the nteract source build");
	}
	close(): Promise<void> {
		return Promise.reject(
			new Error("@runtimed/node relay is provided by the nteract source build"),
		);
	}
}

export function createRelay(_options?: CreateRelayOptions): Promise<RelaySession> {
	return Promise.reject(new Error("@runtimed/node relay is provided by the nteract source build"));
}
export function openRelayPath(_path: string, _options?: OpenRelayOptions): Promise<RelaySession> {
	return Promise.reject(new Error("@runtimed/node relay is provided by the nteract source build"));
}
export function connectRelay(
	_notebookId: string,
	_options?: OpenRelayOptions,
): Promise<RelaySession> {
	return Promise.reject(new Error("@runtimed/node relay is provided by the nteract source build"));
}
export function defaultSocketPath(): string {
	throw new Error("@runtimed/node relay is provided by the nteract source build");
}
export function socketPathForChannel(_channel: "stable" | "nightly"): string {
	throw new Error("@runtimed/node relay is provided by the nteract source build");
}
export function queryDaemonInfo(_options?: QueryDaemonOptions): Promise<DaemonInfo | null> {
	return Promise.reject(new Error("@runtimed/node relay is provided by the nteract source build"));
}

import {
	MAGIC,
	MAX_FRAME_SIZE,
	PREAMBLE_BYTE_LENGTH,
	PROTOCOL_VERSION,
	frameSizeLimits,
	isKnownFrameType,
} from "./constants.js";

export const LENGTH_PREFIX_BYTE_LENGTH = 4;

/** A decoded typed frame: the 1-byte discriminator and its payload. */
export interface TypedFrame {
	readonly frameType: number;
	readonly payload: Buffer;
}

export class WireProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WireProtocolError";
	}
}

/** The 5-byte connection preamble: magic bytes then the version byte. */
export function encodePreamble(): Buffer {
	return Buffer.from([...MAGIC, PROTOCOL_VERSION]);
}

/**
 * Validates a preamble read back from the daemon. The daemon itself checks only
 * the magic bytes and defers version policy until the handshake channel is
 * known, but a client that reads a mismatched version has nothing to negotiate
 * with: v4 removed the v3 request variants and there is no fallback path.
 */
export function assertProtocolVersion(preamble: Buffer): void {
	if (preamble.length < PREAMBLE_BYTE_LENGTH) {
		throw new WireProtocolError(
			`short preamble: expected ${PREAMBLE_BYTE_LENGTH} bytes, got ${preamble.length}`,
		);
	}
	for (const [index, byte] of MAGIC.entries()) {
		if (preamble[index] !== byte) {
			throw new WireProtocolError(
				`bad magic bytes: expected ${formatBytes(MAGIC)}, got ${formatBytes([
					...preamble.subarray(0, MAGIC.length),
				])}`,
			);
		}
	}
	const version = preamble[MAGIC.length];
	if (version !== PROTOCOL_VERSION) {
		throw new WireProtocolError(
			`protocol version mismatch: daemon speaks v${version}, this app speaks v${PROTOCOL_VERSION}. ` +
				"The bundled daemon must be built from the same commit as this app.",
		);
	}
}

function formatBytes(bytes: readonly number[]): string {
	return bytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(" ");
}

/**
 * Length-prefixes an untyped payload — the framing used by the handshake JSON
 * and by the `pool` / `settings_sync` channels, which predate typed frames.
 */
/**
 * Length-prefixes an untyped payload. Callers pass JSON, which `#shiftFrame`
 * relies on to tell untyped frames from typed ones — see the note there before
 * encoding a non-JSON payload through this.
 */
export function encodeFrame(payload: Buffer | string): Buffer {
	const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
	if (body.length > MAX_FRAME_SIZE) {
		throw new WireProtocolError(`outbound frame too large: ${body.length} bytes`);
	}
	const header = Buffer.alloc(LENGTH_PREFIX_BYTE_LENGTH);
	header.writeUInt32BE(body.length, 0);
	return Buffer.concat([header, body]);
}

/**
 * Length-prefixes a typed frame as `u32 length | type byte | payload`, where
 * the length covers the type byte. Enforces the same per-type cap the receive
 * path does: an outbound oversize fails locally rather than producing a frame
 * the daemon will reject with a generic connection drop.
 */
export function encodeTypedFrame(frameType: number, payload: Buffer): Buffer {
	const { cap } = frameSizeLimits(frameType);
	if (payload.length > cap) {
		throw new WireProtocolError(
			`outbound frame too large: type 0x${frameType.toString(16).padStart(2, "0")} ` +
				`payload ${payload.length} bytes exceeds cap ${cap}`,
		);
	}
	const header = Buffer.alloc(LENGTH_PREFIX_BYTE_LENGTH + 1);
	header.writeUInt32BE(payload.length + 1, 0);
	header.writeUInt8(frameType, LENGTH_PREFIX_BYTE_LENGTH);
	return Buffer.concat([header, payload]);
}

export function decodeTypedFrame(frame: Buffer): TypedFrame {
	if (frame.length === 0) {
		throw new WireProtocolError("empty frame");
	}
	return { frameType: frame.readUInt8(0), payload: frame.subarray(1) };
}

/**
 * Incremental reassembler for the length-prefixed stream.
 *
 * A socket `data` event carries an arbitrary slice of the stream: half a frame,
 * three frames, or a length prefix split across two chunks. This buffers until
 * whole frames are available. Frames are emitted with the length prefix
 * stripped but the type byte intact, which is exactly what the relay forwards
 * to the renderer.
 *
 * Ported from `LengthPrefixedFrames` in nteract's
 * `apps/notebook/vite-plugin-browser-relay.ts`, with the per-type cap check
 * added to match the Rust receive path.
 */
export class LengthPrefixedFrames {
	#buffer: Buffer = Buffer.alloc(0);
	#waiters: Array<{
		resolve: (frame: Buffer) => void;
		reject: (error: Error) => void;
	}> = [];
	#liveHandler: ((frame: Buffer) => void) | null = null;
	#failure: Error | null = null;
	/**
	 * Complete frames with no consumer yet. The daemon starts sending as soon as
	 * the handshake is written, but the relay has async work to do (querying
	 * daemon info over a second socket) between reading the bootstrap frame and
	 * attaching its handler. Frames that land in that window are held here
	 * instead of being dropped — losing an Automerge sync frame would leave the
	 * notebook document permanently non-interactive.
	 */
	#ready: Buffer[] = [];

	/** Bytes buffered but not yet forming a complete frame. */
	get pendingByteLength(): number {
		return this.#buffer.length;
	}

	/** Complete frames buffered while no reader or handler was attached. */
	get readyFrameCount(): number {
		return this.#ready.length;
	}

	/**
	 * Appends a chunk and dispatches any frames it completes. Throws if the
	 * stream is malformed, at which point the connection must be dropped — the
	 * stream cannot be resynchronized once a length prefix is not trustworthy.
	 */
	push(chunk: Buffer): void {
		this.#buffer = this.#buffer.length > 0 ? Buffer.concat([this.#buffer, chunk]) : chunk;
		this.#drain();
	}

	/** Resolves with the next whole frame. Used for the handshake exchange. */
	readFrame(): Promise<Buffer> {
		const held = this.#ready.shift();
		if (held) return Promise.resolve(held);
		if (this.#failure) return Promise.reject(this.#failure);
		const frame = this.#shiftFrame();
		if (frame) return Promise.resolve(frame);
		return new Promise((resolve, reject) => {
			this.#waiters.push({ resolve, reject });
		});
	}

	/**
	 * Switches to streaming mode: every subsequent frame goes to `handler`.
	 * Called after the handshake, when frames start flowing to the renderer.
	 */
	pipeTo(handler: (frame: Buffer) => void): void {
		this.#liveHandler = handler;
		const held = this.#ready;
		this.#ready = [];
		for (const frame of held) handler(frame);
		this.#drain();
	}

	/** Rejects all pending readers. Idempotent; the first error wins. */
	fail(error: Error): void {
		this.#failure ??= error;
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const waiter of waiters) waiter.reject(error);
	}

	#drain(): void {
		let frame: Buffer | null;
		while ((frame = this.#shiftFrame())) {
			const waiter = this.#waiters.shift();
			if (waiter) waiter.resolve(frame);
			else if (this.#liveHandler) this.#liveHandler(frame);
			else this.#ready.push(frame);
		}
	}

	#shiftFrame(): Buffer | null {
		if (this.#buffer.length < LENGTH_PREFIX_BYTE_LENGTH) return null;
		const length = this.#buffer.readUInt32BE(0);

		if (length === 0) {
			throw new WireProtocolError("empty frame");
		}
		// Outer ceiling first, before the type byte is even read — mirrors
		// `recv_typed_frame` so a garbage length cannot drive a huge allocation.
		if (length > MAX_FRAME_SIZE) {
			throw new WireProtocolError(`frame too large: ${length} bytes (max ${MAX_FRAME_SIZE})`);
		}

		// The type byte arrives with the body, so the per-type cap can only be
		// applied once at least one byte past the prefix is buffered.
		//
		// This reader also carries untyped frames (the handshake JSON and the
		// `pool`/`settings_sync` channels), which have no type byte — the first
		// body byte there is payload. Reading it as a discriminator is safe only
		// because every untyped payload is JSON and so starts with `{` (0x7b),
		// outside the FrameType range, leaving `isKnownFrameType` false. Keep that
		// invariant: an untyped payload whose first byte fell in 0x00–0x0a would
		// have an unrelated per-type cap applied and could be wrongly rejected.
		if (this.#buffer.length > LENGTH_PREFIX_BYTE_LENGTH) {
			const frameType = this.#buffer.readUInt8(LENGTH_PREFIX_BYTE_LENGTH);
			const bodyLength = length - 1;
			if (isKnownFrameType(frameType) && bodyLength > frameSizeLimits(frameType).cap) {
				throw new WireProtocolError(
					`frame type 0x${frameType.toString(16).padStart(2, "0")} exceeds cap: ` +
						`${bodyLength} bytes (cap ${frameSizeLimits(frameType).cap})`,
				);
			}
		}

		if (this.#buffer.length < LENGTH_PREFIX_BYTE_LENGTH + length) return null;
		const frame = this.#buffer.subarray(
			LENGTH_PREFIX_BYTE_LENGTH,
			LENGTH_PREFIX_BYTE_LENGTH + length,
		);
		this.#buffer = this.#buffer.subarray(LENGTH_PREFIX_BYTE_LENGTH + length);
		return frame;
	}
}

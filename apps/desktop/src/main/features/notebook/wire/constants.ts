/**
 * Typed-frame v4 wire constants, mirrored from nteract's
 * `packages/runtimed/src/wire-constants.ts`, which is itself generated from
 * `notebook_wire::frame_size_limits` by
 * `cargo run -p notebook-protocol --bin generate-runtimed-types`.
 *
 * These are copied rather than imported: `runtimed` is a `private` workspace
 * package in the nteract repo and is not published (the `runtimed` name on npm
 * is an unrelated stub at 0.0.1). Protocol v4 fails closed with no downgrade
 * path, and the app↔daemon relationship requires commit-hash equality, so the
 * daemon build must be pinned against this copy. `assertProtocolVersion` in
 * ./codec.ts is the runtime guard that turns drift into a clear error instead
 * of a corrupt stream.
 */

export const MAGIC = Object.freeze([0xc0, 0xde, 0x01, 0xac]);

export const PROTOCOL_VERSION = 4;

export const PREAMBLE_BYTE_LENGTH = MAGIC.length + 1;

export const FrameType = {
	AUTOMERGE_SYNC: 0x00,
	REQUEST: 0x01,
	RESPONSE: 0x02,
	BROADCAST: 0x03,
	PRESENCE: 0x04,
	RUNTIME_STATE_SYNC: 0x05,
	POOL_STATE_SYNC: 0x06,
	SESSION_CONTROL: 0x07,
	PUT_BLOB: 0x08,
	COMMS_DOC_SYNC: 0x09,
	COMMENTS_DOC_SYNC: 0x0a,
} as const;

export type FrameTypeName = keyof typeof FrameType;
export type FrameTypeValue = (typeof FrameType)[FrameTypeName];

/** Absolute maximum frame size, from `notebook_wire::MAX_FRAME_SIZE`. */
export const MAX_FRAME_SIZE = 104_857_600;

/** Maximum control-frame size, from `notebook_wire::MAX_CONTROL_FRAME_SIZE`. */
export const MAX_CONTROL_FRAME_SIZE = 65_536;

export interface FrameSizeLimits {
	/** Hard payload cap in bytes; larger frames are rejected. */
	readonly cap: number;
	/** Soft payload threshold in bytes; larger frames are logged. */
	readonly warn: number;
}

export const FRAME_SIZE_LIMITS = {
	[FrameType.AUTOMERGE_SYNC]: { cap: 67_108_864, warn: 16_777_216 },
	[FrameType.REQUEST]: { cap: 16_777_216, warn: 262_144 },
	[FrameType.RESPONSE]: { cap: 67_108_864, warn: 16_777_216 },
	[FrameType.BROADCAST]: { cap: 16_777_216, warn: 4_194_304 },
	[FrameType.PRESENCE]: { cap: 4_096, warn: 1_024 },
	[FrameType.RUNTIME_STATE_SYNC]: { cap: 67_108_864, warn: 16_777_216 },
	[FrameType.POOL_STATE_SYNC]: { cap: 1_048_576, warn: 262_144 },
	[FrameType.SESSION_CONTROL]: { cap: 1_048_576, warn: 262_144 },
	[FrameType.PUT_BLOB]: { cap: 33_554_432, warn: 8_388_608 },
	[FrameType.COMMS_DOC_SYNC]: { cap: 67_108_864, warn: 16_777_216 },
	[FrameType.COMMENTS_DOC_SYNC]: { cap: 67_108_864, warn: 16_777_216 },
} as const satisfies Readonly<Record<FrameTypeValue, FrameSizeLimits>>;

/**
 * Payload limits for a typed frame. Unknown types fall back to the outer
 * ceiling so forward-compat frames from a newer daemon are still bounded.
 */
export function frameSizeLimits(frameType: number): FrameSizeLimits {
	return (
		FRAME_SIZE_LIMITS[frameType as FrameTypeValue] ?? {
			cap: MAX_FRAME_SIZE,
			warn: Math.floor(MAX_FRAME_SIZE / 2),
		}
	);
}

export function isKnownFrameType(frameType: number): frameType is FrameTypeValue {
	return frameType in FRAME_SIZE_LIMITS;
}

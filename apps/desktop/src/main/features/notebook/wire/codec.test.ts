import { describe, expect, it, vi } from "vitest";

import {
	LengthPrefixedFrames,
	WireProtocolError,
	assertProtocolVersion,
	decodeTypedFrame,
	encodeFrame,
	encodePreamble,
	encodeTypedFrame,
} from "./codec.js";
import { FrameType, MAX_FRAME_SIZE } from "./constants.js";

/** Builds a wire-format frame the way the daemon would, for decode tests. */
function wireFrame(frameType: number, payload: Buffer | string): Buffer {
	const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
	const header = Buffer.alloc(5);
	header.writeUInt32BE(body.length + 1, 0);
	header.writeUInt8(frameType, 4);
	return Buffer.concat([header, body]);
}

describe("preamble", () => {
	it("encodes the 5-byte magic-plus-version preamble from the ADR", () => {
		expect([...encodePreamble()]).toEqual([0xc0, 0xde, 0x01, 0xac, 4]);
	});

	it("accepts a matching preamble", () => {
		expect(() => assertProtocolVersion(encodePreamble())).not.toThrow();
	});

	it("rejects bad magic bytes with both expected and actual in the message", () => {
		const preamble = Buffer.from([0xde, 0xad, 0xbe, 0xef, 4]);
		expect(() => assertProtocolVersion(preamble)).toThrow(/bad magic bytes/);
		expect(() => assertProtocolVersion(preamble)).toThrow(/0xc0 0xde 0x01 0xac/);
	});

	it("rejects a version mismatch and names the protocol requirement", () => {
		const preamble = Buffer.from([0xc0, 0xde, 0x01, 0xac, 3]);
		expect(() => assertProtocolVersion(preamble)).toThrow(/daemon speaks v3/);
		expect(() => assertProtocolVersion(preamble)).toThrow(/supports this protocol/);
	});

	it("rejects a truncated preamble rather than reading past the end", () => {
		expect(() => assertProtocolVersion(Buffer.from([0xc0, 0xde]))).toThrow(/short preamble/);
	});
});

describe("encodeFrame", () => {
	it("prefixes an untyped payload with its big-endian length", () => {
		const frame = encodeFrame("hi");
		expect(frame.readUInt32BE(0)).toBe(2);
		expect(frame.subarray(4).toString("utf8")).toBe("hi");
	});

	it("measures length in bytes, not UTF-16 code units", () => {
		// A 4-byte emoji is 2 JS string characters — a .length bug here would
		// desync the daemon's stream on the very first handshake frame.
		const frame = encodeFrame("🐍");
		expect(frame.readUInt32BE(0)).toBe(4);
	});

	it("accepts an empty payload", () => {
		expect(encodeFrame("").readUInt32BE(0)).toBe(0);
	});
});

describe("encodeTypedFrame", () => {
	it("writes length covering the type byte, then the type byte, then payload", () => {
		const frame = encodeTypedFrame(FrameType.REQUEST, Buffer.from("abc"));
		expect(frame.readUInt32BE(0)).toBe(4);
		expect(frame.readUInt8(4)).toBe(0x01);
		expect(frame.subarray(5).toString("utf8")).toBe("abc");
	});

	it("encodes a zero-length payload as a length of 1", () => {
		const frame = encodeTypedFrame(FrameType.AUTOMERGE_SYNC, Buffer.alloc(0));
		expect(frame.readUInt32BE(0)).toBe(1);
		expect(frame).toHaveLength(5);
	});

	it("rejects an outbound payload over the per-type cap without writing bytes", () => {
		// PRESENCE caps at 4 KiB — far below the 100 MiB outer ceiling, so this
		// asserts the per-type lookup is really being consulted.
		expect(() => encodeTypedFrame(FrameType.PRESENCE, Buffer.alloc(4097))).toThrow(
			/exceeds cap 4096/,
		);
	});

	it("allows a payload exactly at the cap", () => {
		expect(() => encodeTypedFrame(FrameType.PRESENCE, Buffer.alloc(4096))).not.toThrow();
	});

	it("round-trips through decodeTypedFrame", () => {
		const frame = encodeTypedFrame(FrameType.SESSION_CONTROL, Buffer.from("{}"));
		const decoded = decodeTypedFrame(frame.subarray(4));
		expect(decoded.frameType).toBe(FrameType.SESSION_CONTROL);
		expect(decoded.payload.toString("utf8")).toBe("{}");
	});
});

describe("decodeTypedFrame", () => {
	it("splits the type byte from the payload", () => {
		const decoded = decodeTypedFrame(Buffer.from([0x02, 0x7b, 0x7d]));
		expect(decoded.frameType).toBe(FrameType.RESPONSE);
		expect(decoded.payload.toString("utf8")).toBe("{}");
	});

	it("rejects an empty frame", () => {
		expect(() => decodeTypedFrame(Buffer.alloc(0))).toThrow(WireProtocolError);
	});
});

describe("LengthPrefixedFrames", () => {
	it("reassembles a frame delivered one byte at a time", async () => {
		const frames = new LengthPrefixedFrames();
		const pending = frames.readFrame();
		const wire = wireFrame(FrameType.RESPONSE, "hello");
		for (const byte of wire) frames.push(Buffer.from([byte]));
		expect((await pending).subarray(1).toString("utf8")).toBe("hello");
	});

	it("splits multiple frames arriving in a single chunk", () => {
		const frames = new LengthPrefixedFrames();
		const received: Buffer[] = [];
		frames.pipeTo((frame) => received.push(frame));
		frames.push(
			Buffer.concat([wireFrame(FrameType.REQUEST, "one"), wireFrame(FrameType.RESPONSE, "two")]),
		);
		expect(received.map((f) => f.subarray(1).toString("utf8"))).toEqual(["one", "two"]);
		expect(received.map((f) => f.readUInt8(0))).toEqual([FrameType.REQUEST, FrameType.RESPONSE]);
	});

	it("holds a partial trailing frame until the rest arrives", () => {
		const frames = new LengthPrefixedFrames();
		const received: Buffer[] = [];
		frames.pipeTo((frame) => received.push(frame));
		const wire = wireFrame(FrameType.RESPONSE, "abcdef");
		frames.push(wire.subarray(0, 7));
		expect(received).toHaveLength(0);
		expect(frames.pendingByteLength).toBe(7);
		frames.push(wire.subarray(7));
		expect(received).toHaveLength(1);
		expect(frames.pendingByteLength).toBe(0);
	});

	it("does not treat a length prefix split across chunks as a short frame", () => {
		const frames = new LengthPrefixedFrames();
		const received: Buffer[] = [];
		frames.pipeTo((frame) => received.push(frame));
		const wire = wireFrame(FrameType.RESPONSE, "x");
		frames.push(wire.subarray(0, 2));
		expect(received).toHaveLength(0);
		frames.push(wire.subarray(2));
		expect(received).toHaveLength(1);
	});

	it("queues frames that arrive before pipeTo is attached", () => {
		const frames = new LengthPrefixedFrames();
		frames.push(wireFrame(FrameType.BROADCAST, "early"));
		const received: Buffer[] = [];
		frames.pipeTo((frame) => received.push(frame));
		expect(received.map((f) => f.subarray(1).toString("utf8"))).toEqual(["early"]);
	});

	it("resolves readers in FIFO order", async () => {
		const frames = new LengthPrefixedFrames();
		const first = frames.readFrame();
		const second = frames.readFrame();
		frames.push(
			Buffer.concat([wireFrame(FrameType.REQUEST, "1"), wireFrame(FrameType.REQUEST, "2")]),
		);
		expect((await first).subarray(1).toString("utf8")).toBe("1");
		expect((await second).subarray(1).toString("utf8")).toBe("2");
	});

	it("rejects a zero length rather than spinning on a stalled stream", () => {
		const frames = new LengthPrefixedFrames();
		expect(() => frames.push(Buffer.from([0, 0, 0, 0]))).toThrow(/empty frame/);
	});

	it("rejects a length past the outer ceiling before allocating", () => {
		const frames = new LengthPrefixedFrames();
		const header = Buffer.alloc(4);
		header.writeUInt32BE(MAX_FRAME_SIZE + 1, 0);
		expect(() => frames.push(header)).toThrow(/frame too large/);
	});

	it("rejects an inbound frame over its per-type cap", () => {
		// A corrupted length prefix aimed at the narrow PRESENCE channel is
		// caught by the per-type cap, well before the 100 MiB outer ceiling.
		const frames = new LengthPrefixedFrames();
		const header = Buffer.alloc(5);
		header.writeUInt32BE(8192, 0);
		header.writeUInt8(FrameType.PRESENCE, 4);
		expect(() => frames.push(header)).toThrow(/exceeds cap/);
	});

	it("does not cap-check unknown frame types, for forward compatibility", () => {
		// A newer daemon may send a type this build does not know; it must be
		// buffered and passed through, not rejected.
		const frames = new LengthPrefixedFrames();
		const received: Buffer[] = [];
		frames.pipeTo((frame) => received.push(frame));
		frames.push(wireFrame(0x7f, "from the future"));
		expect(received).toHaveLength(1);
		expect(received[0]?.readUInt8(0)).toBe(0x7f);
	});

	it("rejects pending readers when the stream fails", async () => {
		const frames = new LengthPrefixedFrames();
		const pending = frames.readFrame();
		frames.fail(new Error("socket closed"));
		await expect(pending).rejects.toThrow("socket closed");
	});

	it("keeps the first failure and rejects later reads with it", async () => {
		const frames = new LengthPrefixedFrames();
		frames.fail(new Error("first"));
		frames.fail(new Error("second"));
		await expect(frames.readFrame()).rejects.toThrow("first");
	});

	it("holds frames that arrive with no consumer, then hands them to a later reader", async () => {
		// The daemon starts sending immediately after the handshake, while the
		// relay is still querying daemon info. Dropping frames in that window
		// would strand the notebook document mid-sync.
		const frames = new LengthPrefixedFrames();
		frames.push(wireFrame(FrameType.AUTOMERGE_SYNC, "sync"));
		expect(frames.readyFrameCount).toBe(1);
		expect((await frames.readFrame()).subarray(1).toString("utf8")).toBe("sync");
		expect(frames.readyFrameCount).toBe(0);
	});

	it("delivers held frames in order once a handler attaches", () => {
		const handler = vi.fn();
		const frames = new LengthPrefixedFrames();
		frames.push(wireFrame(FrameType.AUTOMERGE_SYNC, "a"));
		frames.push(wireFrame(FrameType.RUNTIME_STATE_SYNC, "b"));
		expect(handler).not.toHaveBeenCalled();
		frames.pipeTo(handler);
		expect(
			handler.mock.calls.map((call) => (call[0] as Buffer).subarray(1).toString("utf8")),
		).toEqual(["a", "b"]);
	});

	it("drains held frames before reporting a later failure", async () => {
		// A frame already received is still valid data even though the socket
		// has since closed; the error must not mask it.
		const frames = new LengthPrefixedFrames();
		frames.push(wireFrame(FrameType.RESPONSE, "landed"));
		frames.fail(new Error("socket closed"));
		expect((await frames.readFrame()).subarray(1).toString("utf8")).toBe("landed");
		await expect(frames.readFrame()).rejects.toThrow("socket closed");
	});
});

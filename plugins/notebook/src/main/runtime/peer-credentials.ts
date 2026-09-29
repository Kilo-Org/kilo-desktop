import { createConnection, type Socket } from "node:net";
import { readlink } from "node:fs/promises";

import type { PeerIdentity } from "./daemon-peer-auth.js";

/**
 * Reads the OS peer credentials of the process listening on the daemon socket.
 *
 * Node exposes no peer-credential API, so this bridges to the platform syscalls
 * via koffi FFI:
 *   - macOS: `getsockopt(SOL_LOCAL, LOCAL_PEERPID)` + `getpeereid`, image via
 *     `proc_pidpath`.
 *   - Linux: `getsockopt(SOL_SOCKET, SO_PEERCRED)`, image via `/proc/<pid>/exe`.
 *   - Windows: open the named pipe with `CreateFileW` (query-only access),
 *     `GetNamedPipeServerProcessId`, image via `QueryFullProcessImageNameW`.
 *
 * Everything fails closed: any missing fd, syscall error, or absent koffi
 * returns `null`, which the trust decision treats as "do not trust". koffi is
 * loaded lazily so importing this module never crashes a build or a platform
 * where the addon is unavailable.
 *
 * Reading the credentials is mildly intrusive to the daemon: on Unix we connect
 * then immediately destroy the socket, and on Windows we open a named-pipe
 * instance (consuming one) then close it. A well-behaved runtimed tolerates
 * this, but it may show up as a brief client connect/disconnect in daemon logs.
 */

export type PeerCredentialResolver = (socketPath: string) => Promise<PeerIdentity | null>;

const CONNECT_TIMEOUT_MS = 2_000;

// libc / xnu constants.
// SOL_SOCKET / SO_PEERCRED are the asm-generic values: correct for x86_64 and
// arm64 (our Linux targets are linux-x64 and linux-arm64), but different on mips (18),
// sparc (0x40), parisc, and alpha. They are compile-time ABI constants with no
// runtime query, so they are hardcoded — do not reuse blindly on other arches.
const SOL_SOCKET = 1;
const SO_PEERCRED = 17; // Linux
const SOL_LOCAL = 0; // macOS
const LOCAL_PEERPID = 0x002; // macOS

// Win32 constants.
// GetNamedPipeServerProcessId only needs a query handle, so we open with
// FILE_READ_ATTRIBUTES rather than GENERIC_READ: a daemon that created the pipe
// outbound-only refuses GENERIC_READ (ERROR_ACCESS_DENIED) and would otherwise
// be denied as if it were a squatter.
const FILE_READ_ATTRIBUTES = 0x0080;
const OPEN_EXISTING = 3;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
// A busy pipe (all instances in use) reports ERROR_PIPE_BUSY rather than a hard
// failure; WaitNamedPipeW + a bounded retry avoids denying a saturated daemon.
// These koffi calls are synchronous and run on the Electron main thread, so the
// per-attempt wait is deliberately short: the total worst case
// (PIPE_OPEN_ATTEMPTS * PIPE_WAIT_TIMEOUT_MS) bounds how long a saturated pipe
// can stall the app. A fuller fix is to move the Windows FFI off the main thread
// (koffi async binding / utilityProcess); tracked as a follow-up.
const ERROR_PIPE_BUSY = 231;
const PIPE_WAIT_TIMEOUT_MS = 200;
const PIPE_OPEN_ATTEMPTS = 3;

// CreateFileW reports failure with INVALID_HANDLE_VALUE, i.e. (HANDLE)-1. koffi
// exposes a handle's address as an unsigned BigInt, so the sentinel is the
// all-ones value for the pointer width — 0xFFFFFFFFFFFFFFFF on 64-bit and
// 0xFFFFFFFF on 32-bit. The previous check compared against `-1 >>> 0`
// (0xFFFFFFFF only), so a failed open on 64-bit Windows slipped through as a
// "valid" handle. Match every failure encoding, plus the null handle, so a
// failed open is never mistaken for a live pipe.
const INVALID_PIPE_HANDLE_ADDRESSES: ReadonlySet<bigint> = new Set([
	0n,
	BigInt.asUintN(64, -1n),
	BigInt.asUintN(32, -1n),
]);

export function isInvalidPipeHandleAddress(address: bigint): boolean {
	return INVALID_PIPE_HANDLE_ADDRESSES.has(address);
}

/**
 * Reads a Win32 handle's address as a `bigint`, defensively.
 *
 * koffi 3 reports pointer addresses as `bigint`, but the `Koffi` type is
 * hand-declared, so if `koffi.address` ever returned a `Number` the `bigint`
 * `Set` membership in `isInvalidPipeHandleAddress` would miss and a failed
 * `CreateFileW` (e.g. the 32-bit `INVALID_HANDLE_VALUE`) would be treated as a
 * live handle. Coerce to `bigint`; anything that can't be coerced is reported as
 * `0n` (an invalid-handle sentinel), so the result always fails closed.
 */
function pipeHandleAddress(koffi: Koffi, handle: unknown): bigint {
	const raw: unknown = koffi.address(handle);
	if (typeof raw === "bigint") return raw;
	try {
		return BigInt(raw as number);
	} catch {
		return 0n;
	}
}

interface Koffi {
	load(library: string): {
		func(signature: string): (...args: unknown[]) => number;
		func(name: string, result: string, args: unknown[]): (...args: unknown[]) => unknown;
	};
	out(type: unknown): unknown;
	inout(type: unknown): unknown;
	pointer(type: string): unknown;
	address(value: unknown): bigint;
}

let koffiPromise: Promise<Koffi | null> | undefined;

async function loadKoffi(): Promise<Koffi | null> {
	koffiPromise ??= import("koffi")
		.then((mod) => (mod as { default?: Koffi }).default ?? (mod as unknown as Koffi))
		.catch(() => null);
	return koffiPromise;
}

/**
 * Whether the native FFI backend that peer authentication depends on can load.
 *
 * When this is false the resolver can only ever return `null`, so every daemon
 * is denied. In packaged builds that usually means koffi's native addon was not
 * unpacked from app.asar (see `NOTEBOOK_ASAR_UNPACK_PACKAGES`). Callers use it to
 * surface a loud, actionable warning instead of failing authentication silently.
 */
export async function isPeerCredentialBackendAvailable(): Promise<boolean> {
	return (await loadKoffi()) !== null;
}

export const resolveDaemonPeerIdentity: PeerCredentialResolver = async (socketPath) => {
	try {
		if (process.platform === "win32") {
			const koffi = await loadKoffi();
			if (!koffi) return null;
			return await resolveWindowsPeer(koffi, socketPath);
		}
		if (process.platform === "darwin" || process.platform === "linux") {
			return await resolveUnixPeer(socketPath);
		}
		return null;
	} catch {
		return null;
	}
};

export async function connectForFd(
	socketPath: string,
): Promise<{ socket: Socket; fd: number } | null> {
	return new Promise((resolve) => {
		const socket = createConnection(socketPath);
		// The socket is returned open and read across the FFI calls, then
		// destroyed by the caller's finally block. A hostile listener can accept
		// and then reset it (ECONNRESET/EPIPE) during that window; without an
		// error handler Node rethrows that as an uncaught exception and takes down
		// the whole main process. Keep a no-op error handler for the socket's
		// entire lifetime and only settle the one-shot connect/error races below.
		socket.on("error", () => {});
		let settled = false;
		const settle = (value: { socket: Socket; fd: number } | null) => {
			if (settled) return;
			settled = true;
			socket.setTimeout(0);
			if (!value) socket.destroy();
			resolve(value);
		};
		socket.setTimeout(CONNECT_TIMEOUT_MS, () => settle(null));
		socket.once("error", () => settle(null));
		socket.once("connect", () => {
			// `_handle.fd` is a Node internal — the only way to get the raw fd to
			// hand to getsockopt/getpeereid. If a future Node/Electron drops or
			// renames it this returns null and every daemon is silently denied.
			// `peer-credentials.integration.test.ts` connects to a real socket and
			// asserts a numeric fd, so it fails loudly as a canary if that happens.
			const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd;
			if (typeof fd !== "number" || fd < 0) return settle(null);
			settle({ socket, fd });
		});
	});
}

async function resolveUnixPeer(socketPath: string): Promise<PeerIdentity | null> {
	const koffi = await loadKoffi();
	if (!koffi) return null;
	const connection = await connectForFd(socketPath);
	if (!connection) return null;
	try {
		// `libc.so.6` is safe to hardcode: Electron's prebuilt binaries are
		// glibc-only (no musl/Alpine build), so the app cannot launch without
		// glibc already resident in this process — by the time we get here,
		// `dlopen("libc.so.6")` resolves the already-loaded library. musl is
		// explicitly out of scope, so no candidate-name fallback is needed.
		const lib = koffi.load(process.platform === "darwin" ? "libSystem.dylib" : "libc.so.6");
		if (process.platform === "linux") return await resolveLinuxPeer(koffi, lib, connection.fd);
		return resolveDarwinPeer(koffi, lib, connection.fd);
	} catch {
		return null;
	} finally {
		connection.socket.destroy();
	}
}

type Lib = ReturnType<Koffi["load"]>;

export async function resolveLinuxPeer(
	koffi: Koffi,
	lib: Lib,
	fd: number,
): Promise<PeerIdentity | null> {
	const getsockopt = lib.func("getsockopt", "int", [
		"int",
		"int",
		"int",
		"void *",
		koffi.inout(koffi.pointer("uint32")),
	]) as (...args: unknown[]) => number;
	// struct ucred { pid_t pid; uid_t uid; gid_t gid; } — 12 bytes, little-endian.
	const optval = Buffer.alloc(12);
	const optlen = [12];
	if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, optval, optlen) !== 0) return null;
	const pid = optval.readInt32LE(0);
	const uid = optval.readUInt32LE(4);
	if (pid <= 0) return null;
	return { pid, uid, executablePath: await readLinuxExecutable(pid) };
}

async function readLinuxExecutable(pid: number): Promise<string | null> {
	try {
		return await readlink(`/proc/${pid}/exe`);
	} catch {
		return null;
	}
}

export function resolveDarwinPeer(koffi: Koffi, lib: Lib, fd: number): PeerIdentity | null {
	const getsockopt = lib.func("getsockopt", "int", [
		"int",
		"int",
		"int",
		koffi.out(koffi.pointer("int")),
		koffi.inout(koffi.pointer("uint32")),
	]) as (fd: number, level: number, name: number, out: number[], len: number[]) => number;
	const getpeereid = lib.func("getpeereid", "int", [
		"int",
		koffi.out(koffi.pointer("uint32")),
		koffi.out(koffi.pointer("uint32")),
	]) as (fd: number, uid: number[], gid: number[]) => number;

	const pidOut = [0];
	const pidLen = [4];
	if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, pidOut, pidLen) !== 0) return null;
	const pid = pidOut[0] ?? 0;
	if (pid <= 0) return null;

	// Fail closed: a local socket always has a peer uid, so a getpeereid failure
	// (or a missing value) is an anomaly. Returning an identity with `uid: null`
	// here would silently disable the same-user check for a real macOS peer
	// (null uid is meant only for Windows named pipes), so deny instead.
	const uidOut = [0];
	const gidOut = [0];
	if (getpeereid(fd, uidOut, gidOut) !== 0) return null;
	const uid = uidOut[0];
	if (uid === undefined) return null;

	return { pid, uid, executablePath: readDarwinExecutable(lib, pid) };
}

function readDarwinExecutable(lib: Lib, pid: number): string | null {
	try {
		const procPidpath = lib.func("proc_pidpath", "int", ["int", "void *", "uint32"]) as (
			pid: number,
			buffer: Buffer,
			size: number,
		) => number;
		const buffer = Buffer.alloc(4096);
		const length = procPidpath(pid, buffer, buffer.length);
		return length > 0 ? buffer.toString("utf8", 0, length) : null;
	} catch {
		return null;
	}
}

export async function resolveWindowsPeer(
	koffi: Koffi,
	socketPath: string,
): Promise<PeerIdentity | null> {
	const kernel32 = koffi.load("kernel32.dll");
	const createFileW = kernel32.func("CreateFileW", "void *", [
		"str16",
		"uint32",
		"uint32",
		"void *",
		"uint32",
		"uint32",
		"void *",
	]) as (...args: unknown[]) => unknown;
	const getLastError = kernel32.func("GetLastError", "uint32", []) as () => number;
	const waitNamedPipeW = kernel32.func("WaitNamedPipeW", "int", ["str16", "uint32"]) as (
		name: string,
		timeout: number,
	) => number;
	const getServerPid = kernel32.func("GetNamedPipeServerProcessId", "int", [
		"void *",
		koffi.out(koffi.pointer("uint32")),
	]) as (handle: unknown, out: number[]) => number;
	const openProcess = kernel32.func("OpenProcess", "void *", ["uint32", "int", "uint32"]) as (
		...args: unknown[]
	) => unknown;
	const queryImage = kernel32.func("QueryFullProcessImageNameW", "int", [
		"void *",
		"uint32",
		"void *",
		koffi.inout(koffi.pointer("uint32")),
	]) as (handle: unknown, flags: number, buffer: Buffer, size: number[]) => number;
	const closeHandle = kernel32.func("CloseHandle", "int", ["void *"]) as (
		handle: unknown,
	) => number;

	// Open a query-only handle to the pipe, retrying while it reports
	// ERROR_PIPE_BUSY so a momentarily-saturated daemon is not denied as absent.
	let pipe: unknown = null;
	for (let attempt = 0; attempt < PIPE_OPEN_ATTEMPTS; attempt++) {
		const handle = createFileW(socketPath, FILE_READ_ATTRIBUTES, 0, null, OPEN_EXISTING, 0, null);
		if (!isInvalidPipeHandleAddress(pipeHandleAddress(koffi, handle))) {
			pipe = handle;
			break;
		}
		if (getLastError() !== ERROR_PIPE_BUSY) return null;
		if (waitNamedPipeW(socketPath, PIPE_WAIT_TIMEOUT_MS) === 0) return null;
	}
	if (pipe === null) return null;

	try {
		const pidOut = [0];
		if (getServerPid(pipe, pidOut) === 0) return null;
		const pid = pidOut[0] ?? 0;
		if (pid <= 0) return null;
		return {
			pid,
			uid: null,
			executablePath: readWindowsExecutable(pid, openProcess, queryImage, closeHandle),
		};
	} finally {
		closeHandle(pipe);
	}
}

function readWindowsExecutable(
	pid: number,
	openProcess: (...args: unknown[]) => unknown,
	queryImage: (handle: unknown, flags: number, buffer: Buffer, size: number[]) => number,
	closeHandle: (handle: unknown) => number,
): string | null {
	const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
	if (!handle) return null;
	try {
		const buffer = Buffer.alloc(32_768 * 2); // MAX_PATH-extended, UTF-16
		const size = [32_768];
		if (queryImage(handle, 0, buffer, size) === 0) return null;
		return buffer.toString("utf16le", 0, (size[0] ?? 0) * 2);
	} finally {
		closeHandle(handle);
	}
}

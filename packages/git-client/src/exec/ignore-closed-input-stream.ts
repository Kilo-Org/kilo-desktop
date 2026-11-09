import type { ChildProcess } from "node:child_process";

/**
 * Prevent errors originating from the stdin stream related to the child
 * process closing the pipe from bubbling up and causing an unhandled
 * exception when no error handler is attached to the input stream.
 *
 * The common scenario is a consumer writing to the stdin stream of a child
 * process that terminates or closes its standard input early — e.g. git
 * exiting immediately on an unknown argument while a large stdin payload is
 * still being written.
 *
 * Since consumers of `exec` cannot get a hold of the stream until after we've
 * written data to it they're unable to fix it themselves, so we ignore the
 * error for them. By suppressing the stream error we can pick up on the real
 * error when the process exits, from the exit code and standard error.
 *
 * Ported from dugite's ignore-closed-input-stream.
 * See https://github.com/desktop/desktop/pull/4027#issuecomment-366213276
 */
export function ignoreClosedInputStream({ stdin }: ChildProcess): void {
	// If Node fails to spawn due to a runtime error (EACCES, EAGAIN, etc) it
	// will not set up the stdio streams. The error itself is emitted
	// asynchronously, but we're still in the synchronous path, so calling
	// `.on` on `.stdin` (which is undefined) would throw before the
	// underlying error surfaces.
	if (!stdin) {
		return;
	}

	stdin.on("error", (err) => {
		const code = "code" in err && typeof err.code === "string" ? err.code : undefined;

		// The errors we'd expect from the input stream being closed: EPIPE on
		// macOS and EOF on Windows. ECONNRESET has been seen on Linux hosts.
		if (code === "EPIPE" || code === "EOF" || code === "ECONNRESET") {
			return;
		}

		// Something else. If we're the only error listener, mimic the
		// EventEmitter behavior of throwing unhandled 'error' events.
		if (stdin.listeners("error").length <= 1) {
			throw err;
		}
	});
}

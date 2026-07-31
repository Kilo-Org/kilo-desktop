import log from "electron-log";

/**
 * Shared main-process logger backed by `electron-log`.
 *
 * Use scoped loggers instead of hand-written `[subject]` string prefixes:
 * `electron-log`'s scope is the sink label, so messages are consistently
 * tagged, filterable, and routed through the console + file transports
 * (dev: your `pnpm dev` terminal; packaged: the on-disk log file).
 *
 * @example
 * const logger = createLogger("auth");
 * logger.info("login started");   // tagged with the "auth" scope
 * logger.error("login failed", cause);
 */
export type Logger = ReturnType<typeof log.scope>;

/**
 * Create a scoped logger (sink) for a subsystem. Uses the shared `electron-log`
 * instance, whose console + file transports are active by default in the main
 * process — no `initialize()` needed (that only wires the renderer/IPC bridge).
 */
export function createLogger(scope: string): Logger {
	return log.scope(scope);
}

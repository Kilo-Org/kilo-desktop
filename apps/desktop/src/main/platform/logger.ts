import log from "electron-log";
import { z } from "zod";

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

export function getLogFilePath(): string {
	return log.transports.file.getFile().path;
}

/**
 * Log level configuration. electron-log defaults every transport to `silly`,
 * so without this the on-disk log collects debug chatter (e.g. a notebook UI
 * presence sweep logging per cell every few seconds). Levels mirror
 * electron-log's own `LogLevel` so they apply to its transports directly.
 * Precedence: `KILO_LOG_LEVEL` env var > persisted preference > "info".
 */
export const LOG_LEVELS = ["error", "warn", "info", "verbose", "debug", "silly"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const logLevelSchema = z.enum(LOG_LEVELS);
export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const LOG_LEVEL_ENV_VAR = "KILO_LOG_LEVEL";

export function resolveLogLevel(options: {
	env?: string | undefined;
	stored?: string | undefined;
}): LogLevel {
	for (const candidate of [options.env, options.stored]) {
		const parsed = logLevelSchema.safeParse(candidate);
		if (parsed.success) return parsed.data;
	}
	return DEFAULT_LOG_LEVEL;
}

type LogTransports = Pick<typeof log.transports, "console" | "file">;

export function configureLogging(
	level: LogLevel,
	transports: LogTransports = log.transports,
): void {
	transports.console.level = level;
	transports.file.level = level;
}

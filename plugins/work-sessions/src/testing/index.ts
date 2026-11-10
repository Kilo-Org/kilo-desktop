// Test host for kilo.work-sessions' window areas and for plugins that
// contribute to them: boots the real shell and kilo.work-sessions' real web
// entry over an in-memory stand-in for its main-process domain objects. It
// lives in src/test, where tests may use kilo.shell's own `./testing`.
export * from "../test/work-sessions-host";

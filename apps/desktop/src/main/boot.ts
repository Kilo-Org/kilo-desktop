// The main process's entry: turns on Node's compile cache, then loads the
// app. A static import is evaluated before this module's own code, so the
// 4 MB app bundle is imported dynamically, once the cache is on; launches
// after the first then reuse its compiled bytecode instead of parsing and
// compiling it again.
import { enableCompileCache } from "node:module";

enableCompileCache();

// `app.js` is built beside this file from main.ts (vite.main.config.ts); a
// variable keeps the bundler and the type checker from resolving it here.
const app = "./app.js";
await import(/* @vite-ignore */ app);

import { validatePublishEnvironment } from "./release.js";

validatePublishEnvironment(process.env, process.platform);

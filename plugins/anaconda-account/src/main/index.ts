import { createAnacondaAccountMainEntry } from "./entry.js";

export { createAnacondaAccountMainEntry, type AnacondaAccountMainOptions } from "./entry.js";

/** kilo.anaconda-account's main entry, on the user's Anaconda keyring and the build's OAuth client. */
export const anacondaAccountMainEntry = createAnacondaAccountMainEntry({
	clientId: import.meta.env.VITE_AUTH_CLIENT_ID ?? "",
});

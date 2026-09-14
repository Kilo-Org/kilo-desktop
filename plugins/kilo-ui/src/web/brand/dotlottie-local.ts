import { setWasmUrl } from "@lottiefiles/dotlottie-react";
import wasmUrl from "@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm?url";

import yellowKiloLogoUrl from "./YellowKiloLogo.lottie?url";

/**
 * DotLottie defaults to jsDelivr/unpkg for its WASM renderer. Point it at the
 * copy shipped in `@lottiefiles/dotlottie-web` so the welcome mark never
 * reaches the network.
 */
setWasmUrl(new URL(wasmUrl, import.meta.url).href);

export const yellowKiloLogoSrc = new URL(yellowKiloLogoUrl, import.meta.url).href;

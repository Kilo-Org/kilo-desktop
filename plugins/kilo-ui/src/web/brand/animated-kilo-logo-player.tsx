"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useSyncExternalStore, type FC } from "react";
import { useSdk } from "@kilo-desktop/sdk-react";

import { lightYellowKiloLogoSrc, yellowKiloLogoSrc } from "./dotlottie-local.js";

export const AnimatedKiloLogoPlayer: FC = () => {
	const sdk = useSdk("kilo-ui");
	const { mode } = useSyncExternalStore(sdk.theme.subscribe, sdk.theme.appearance);
	const src = mode === "light" ? lightYellowKiloLogoSrc : yellowKiloLogoSrc;

	return <DotLottieReact src={src} loop autoplay />;
};

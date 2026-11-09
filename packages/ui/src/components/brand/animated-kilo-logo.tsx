"use client";

import { lazy, Suspense, type FC } from "react";
import { useReducedMotion } from "motion/react";

import { KiloLogo } from "./kilo-logo.js";

const loadAnimatedKiloLogoPlayer = () =>
	import("./animated-kilo-logo-player.js").then((module) => ({
		default: module.AnimatedKiloLogoPlayer,
	}));

const AnimatedKiloLogoPlayer = lazy(loadAnimatedKiloLogoPlayer);

export const AnimatedKiloLogo: FC = () => {
	const reduceMotion = useReducedMotion();

	if (reduceMotion === true) {
		return <KiloLogo />;
	}

	return (
		<Suspense fallback={<KiloLogo />}>
			<AnimatedKiloLogoPlayer />
		</Suspense>
	);
};

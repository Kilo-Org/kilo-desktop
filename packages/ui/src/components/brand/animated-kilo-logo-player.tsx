"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import type { FC } from "react";

import { yellowKiloLogoSrc } from "../../lib/dotlottie-local.js";

export const AnimatedKiloLogoPlayer: FC = () => (
	<DotLottieReact src={yellowKiloLogoSrc} loop autoplay />
);

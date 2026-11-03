import { createContext, useContext } from "react";

/** True inside a settled turn's "Worked for …" fold. */
export const TurnWorkFoldContext = createContext(false);

export const useIsInTurnWorkFold = (): boolean => useContext(TurnWorkFoldContext);

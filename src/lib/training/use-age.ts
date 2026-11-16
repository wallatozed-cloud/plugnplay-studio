import { useCallback, useEffect, useState } from "react";
import { confirmAge, readAgeConfirmation } from "./policy.ts";
import { browserStore } from "./storage.ts";

export type AgeGateState = "loading" | "needed" | "confirmed";

export function useAgeConfirmation(): {
  state: AgeGateState;
  confirm: () => void;
} {
  const [state, setState] = useState<AgeGateState>("loading");

  useEffect(() => {
    setState(readAgeConfirmation(browserStore()) ? "confirmed" : "needed");
  }, []);

  const confirm = useCallback(() => {
    try {
      confirmAge(browserStore(), new Date());
    } catch {
      // Private mode can refuse storage. This visit still proceeds; the gate
      // returns on the next launch if the confirmation could not be saved.
    }
    setState("confirmed");
  }, []);

  return { state, confirm };
}

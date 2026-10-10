import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  detectSkr,
  DetectorGesture,
  SKR_TTL,
  type Detection,
} from "./detection";

export function useSkrRoom(owner: string | null, walletRevision: number) {
  const [result, setResult] = useState<{
    owner: string;
    value: Detection;
  } | null>(null);
  const [club, setClub] = useState(false);
  const [arming, setArming] = useState(false);
  const gesture = useRef(new DetectorGesture());
  const generation = useRef(0);
  const transition = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const status = !owner
    ? "offline"
    : result?.owner === owner
      ? result.value.status
      : "checking";
  const check = useCallback(
    async (force = false) => {
      if (!owner) return;
      const id = generation.current;
      const value = await detectSkr(owner, force);
      if (id === generation.current) {
        setResult({ owner, value });
        if (value.status !== "found") {
          clearTimeout(transition.current);
          setArming(false);
          setClub(false);
          gesture.current.reset();
        }
      }
    },
    [owner],
  );
  useEffect(() => {
    generation.current++;
    setResult(null);
    setClub(false);
    setArming(false);
    gesture.current.reset();
    clearTimeout(transition.current);
    void check(true);
    const sub = AppState.addEventListener("change", (state) => {
      gesture.current.reset();
      if (state === "active") void check();
      else {
        clearTimeout(transition.current);
        setArming(false);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void check();
    }, SKR_TTL);
    return () => {
      generation.current++;
      clearTimeout(transition.current);
      clearInterval(timer);
      sub.remove();
    };
  }, [check, walletRevision]);
  const tap = useCallback(() => {
    if (arming) return;
    if (status === "unavailable" || status === "absent") {
      void check(true);
      return;
    }
    if (!gesture.current.tap(status === "found", Date.now())) return;
    setArming(true);
    transition.current = setTimeout(() => {
      setClub((v) => !v);
      setArming(false);
    }, 550);
  }, [arming, status, check]);
  const refresh = useCallback(() => {
    void check(true);
  }, [check]);
  return {
    club: club && status === "found",
    arming,
    status,
    tap,
    refresh,
  };
}

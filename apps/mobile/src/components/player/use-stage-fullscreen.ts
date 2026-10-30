/**
 * Full screen for the player stage, as the web's full-window layer rather
 * than the native player's full screen (which would bring the system
 * controls and lose text cards and the queue): the same VideoView fills the
 * window, the screen turns to landscape, and the bars step aside (the
 * screen applies `active` to its header, status bar and home indicator).
 * Android's back button leaves full screen before it leaves the screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";

export function useStageFullscreen() {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);

  const enter = useCallback(() => {
    activeRef.current = true;
    setActive(true);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  const exit = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) exit();
    else enter();
  }, [enter, exit]);

  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      exit();
      return true;
    });
    return () => sub.remove();
  }, [active, exit]);

  // Leaving the screen in full screen (a notification, a deep link) puts the app upright again.
  useEffect(
    () => () => {
      if (activeRef.current) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    },
    [],
  );

  return { active, enter, exit, toggle };
}

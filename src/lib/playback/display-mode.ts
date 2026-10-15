type OrientationScreen = Screen & { orientation?: ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void>; unlock?: () => void } };

let listeningForFullscreen = false;
let orientationAttempted = false;

function unlockOrientation() {
  try {
    const orientation = (screen as OrientationScreen).orientation;
    orientation?.unlock?.();
  } catch {
    // Some browsers expose the API but reject or throw when unlocking.
  }
}

export function releasePlaybackDisplay() {
  unlockOrientation();
}

export function requestPlaybackDisplay(target: HTMLElement | null, forceTarget = false): Promise<{ fullscreen: boolean; orientation: boolean }> {
  if (typeof document === "undefined" || typeof screen === "undefined") {
    return Promise.resolve({ fullscreen: false, orientation: false });
  }

  if (!listeningForFullscreen) {
    listeningForFullscreen = true;
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) unlockOrientation();
      orientationAttempted = false;
    });
  }

  let fullscreenRequest: Promise<void> = Promise.resolve();
  if ((!document.fullscreenElement || (forceTarget && document.fullscreenElement !== target)) && document.fullscreenEnabled && target?.requestFullscreen) {
    try {
      // Invoke synchronously from the real user gesture; do not await before calling it.
      fullscreenRequest = target.requestFullscreen();
    } catch {
      fullscreenRequest = Promise.reject();
    }
  }

  return fullscreenRequest
    .catch(() => undefined)
    .then(async () => {
      let orientation = false;
      const api = (screen as OrientationScreen).orientation;
      try {
        if (api?.lock && !orientationAttempted) {
          orientationAttempted = true;
          await api.lock("landscape");
          orientation = true;
        } else {
          orientation = !!api?.type.startsWith("landscape");
        }
      } catch {
        // Orientation is optional: never interrupt playback if the browser refuses.
      }
      return { fullscreen: !!document.fullscreenElement, orientation };
    });
}

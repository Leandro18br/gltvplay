type OrientationScreen = Screen & { orientation?: ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void>; unlock?: () => void } };

let listeningForFullscreen = false;

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

export function requestPlaybackDisplay(target: HTMLElement | null): Promise<{ fullscreen: boolean; orientation: boolean }> {
  if (typeof document === "undefined" || typeof screen === "undefined") {
    return Promise.resolve({ fullscreen: false, orientation: false });
  }

  if (!listeningForFullscreen) {
    listeningForFullscreen = true;
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) unlockOrientation();
    });
  }

  let fullscreenRequest: Promise<void> = Promise.resolve();
  if (!document.fullscreenElement && document.fullscreenEnabled && target?.requestFullscreen) {
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
      try {
        const api = (screen as OrientationScreen).orientation;
        if (api?.lock) {
          await api.lock("landscape");
          orientation = true;
        }
      } catch {
        // Orientation is optional: never interrupt playback if the browser refuses.
      }
      return { fullscreen: !!document.fullscreenElement, orientation };
    });
}

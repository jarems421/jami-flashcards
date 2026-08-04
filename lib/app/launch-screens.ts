import launchScreens from "@/lib/app/launch-screens.json";

export type LaunchScreenLink = {
  url: string;
  media: string;
};

/**
 * The launch screens iOS needs to show something branded while an installed
 * Jami opens.
 *
 * Android draws its own from the manifest's background colour and icon. iOS
 * shows nothing at all unless handed an image whose dimensions and orientation
 * match the device exactly -- a near-match is ignored, which is why every size
 * is listed and why the media query has to name the pixel ratio too.
 *
 * Fed to `metadata.appleWebApp.startupImage` rather than rendered as `<link>`
 * elements. Next writes those into the head once; as JSX they were serialised
 * into the streamed component payload as well, which doubled the size of the
 * one page whose whole purpose is to paint quickly.
 */
export function getLaunchScreenLinks(): LaunchScreenLink[] {
  return launchScreens.devices.flatMap((device) => {
    const shared = `(device-width: ${device.width}px) and (device-height: ${device.height}px) and (-webkit-device-pixel-ratio: ${device.scale})`;

    return [
      {
        url: `/splash/${device.name}-portrait.png`,
        media: `${shared} and (orientation: portrait)`,
      },
      {
        url: `/splash/${device.name}-landscape.png`,
        media: `${shared} and (orientation: landscape)`,
      },
    ];
  });
}

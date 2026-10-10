// Browser detection only chooses help text. The native install event remains
// the authority on whether we can open an installation dialog.
export function installGuide({
  userAgent,
  platform,
  maxTouchPoints,
}: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">) {
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  if (ios)
    return {
      title: "iPhone / iPad",
      instructions:
        "Open your browser’s Share menu (it may be under •••) → Add to Home Screen → Add. Keep Open as Web App on if shown. If the option is missing, open Istmo in Safari and use its Share menu.",
    };
  if (/Android/.test(userAgent))
    return {
      title: "Android",
      instructions:
        "Open your browser menu → Install app or Add to Home screen. For the full app experience, open Istmo in Chrome and choose Install.",
    };
  const mac = /Mac/.test(platform) || /Macintosh/.test(userAgent);
  if (mac && /Firefox\//.test(userAgent))
    return {
      title: "Firefox · Mac",
      instructions:
        "To install Istmo on your Mac, open this same address in Safari and choose File → Add to Dock, or install it using Chrome. Firefox on Mac does not currently offer app installation.",
    };
  if (/Edg\//.test(userAgent))
    return {
      title: "Microsoft Edge",
      instructions:
        "Use the install icon in the address bar, or open ⋯ → More tools → Apps → Install this site as an app.",
    };
  if (/Chrome\//.test(userAgent) && !/OPR\//.test(userAgent))
    return {
      title: "Chrome / Chromium",
      instructions:
        "Use the install icon in the address bar, or open ⋮ → Cast, save, and share → Install page as app. Menu names can vary by browser.",
    };
  if (mac && /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent))
    return {
      title: "Safari · Mac",
      instructions:
        "In Safari, choose File → Add to Dock (or Share → Add to Dock), then Add. Requires macOS Sonoma or later.",
    };
  return {
    title: "Install Istmo",
    instructions:
      "Look for an install icon in the address bar or an Install app option in your browser menu. If neither appears, open Istmo in Chrome, or Safari on Mac.",
  };
}

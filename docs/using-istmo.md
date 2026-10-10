# Using Istmo

Open [Istmo](https://istmo.ramonfabrega.com) in Safari or Chrome. On iPhone, use Share → Add to Home Screen to install it, then enable device notifications from the bell.

## Persistent circles and private maps

People supports multiple lasting circles on one device. Create a circle with a name and your name; use **Invite** to copy or share a seven-day link. Links open a preview/confirmation screen, never silently enroll a person. The invitation secret is in the URL fragment (not server request URLs), then removed from the address bar. New links coexist; revoke links in **Manage**. Members can confirm anyone in their circle, and only owners can rename the circle or change its suggested meeting point.

Each check-in appends to history. The board shows each person's latest status and arrival/departure with timestamps, not online status or a claim that they are currently safe. Circle settings never reset reports. Offline drafts and caches are scoped to the circle; pending drafts are explicitly sent. History is paginated separately from the latest board.

**Circle map**, toggled on the main Observe map or opened from People, shows named gathering spots and the latest shared check-in position per person, for up to 24 hours. The location checkbox starts off on every self check-in; browser permission alone does not share anything with a circle. You cannot attach your device's location to a proxy check-in. Shared snapshots include accuracy and capture time. **Manage → Remove my shared locations** clears your coordinates from that circle's server history; it cannot retract copies already seen or saved by another member. Locations are readable by circle members and the service operator, not end-to-end encrypted. Gathering spots are named by a member after tapping the map; creators and circle owners can remove them.

Device access is bearer-token based. Owners can remove a member under Manage; this revokes their access and all outstanding invitation links, while preserving attributed history. Clearing browser data loses device access. Members can rejoin with a new invitation as a new membership; owner recovery and linking new devices remain follow-up work.

## Sound while the page is open

Open the bell and enable sound to hear a preview and arm a gentle chime for new reports. Pick an agency and minimum magnitude independently of push preferences. It polls Panama reports every 30 seconds, ignores the first response and known IDs/revisions, and only sounds for events from the last 15 minutes. Initial server imports and catch-up after more than five minutes without a successful collection establish a silent baseline; they do not produce new-report markers or alerts. It works while the page is running, including background tabs when the browser permits activity; reload requires a tap to re-arm audio. Background suspension and device mute settings can suppress it. Push subscriptions remain the option for notifications when the page is closed. Desktop notification delivery still needs an end-to-end test on the intended browser/OS.

Sound styles: **Pitch follows magnitude** (default) uses C4, D4, E4, F4, G4, A4, B4, C5 for half-magnitude bands starting at M3 through M6.5. Values below M3 use C4; M6.5 and above use C5. The second tone stays a perfect fourth above the first, with unchanged timing and gain. **Same tone every time** retains the original 660/880 Hz chime. A batch plays once at its strongest qualifying magnitude. Preview any band under Sound options without arming alerts; rapid previews replace the previous chime. The chosen style persists on this device; sound itself remains opt-in.

## Install and update

**Install Istmo** is available in About and in notification settings when push is unavailable. Supported browsers open their native install prompt. On iPhone/iPad, Safari requires Share → Add to Home Screen; the button shows the steps, including the ••• menu used by some Safari layouts. Open the installed app before enabling phone push.

Open apps check for a new release when returning to the foreground and every five minutes while visible. A small update notice offers **Reload** or **Later**; updates never discard an in-progress check-in automatically. About also has **Reload Istmo**. An app running a version from before this feature needs one manual close/reopen or reload to receive it.

A successful notification test means the push provider accepted the encrypted message, not proof that the operating system displayed it. Failed sends now show an error. If accepted but absent, check the device notification center, Focus settings, and notification permission for the browser or installed app.

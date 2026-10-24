# HRD Nusantara notification patch

Source: the cached `geolocator_android` 5.0.3 package from pub.dev, copied intact before this patch. The upstream package license is retained in `LICENSE`. Package archive SHA-256 recorded by the application's original lockfile: `86ea1654e4f61ff51466848e91c116b422d6010ea269fda0fbe1af7e9e742ce1`.

Only these upstream Java files are changed:

- `GeolocatorLocationService.java`: publishes `CHANNEL_ID` and selects the stable `hrd_location_monitoring_v2` channel.
- `location/BackgroundNotification.java`: uses low priority, silence, no sound or vibration, and alert-once behavior; provides `createChannel(Context, String, String)` so the app can prepare and inspect the notification channel before collecting location. The ongoing notification, monitoring text, icon, tap action, and location service behavior are retained.

The new Android channel uses low importance, no sound, vibration, or lights. Its existing settings are never overwritten or its channel deleted. An explicitly blocked legacy `geolocator_channel_01` channel stays blocked during migration on Android 10 and later. Android 8/9 cannot distinguish the old plugin's disabled default from a user block, so that ambiguous disabled state is preserved. HRD must pause collection while notification access is blocked and offer the relevant Android settings screen. App-wide notification permission remains controlled by Android and the user.

No Dart API, location collection, permission, wake-lock, dependency version, or license changes are part of this patch. Keep this vendored package pinned until the same behavior is supported upstream; compare these two files before upgrading.

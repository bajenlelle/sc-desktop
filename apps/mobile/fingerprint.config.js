/**
 * Keep package.json "scripts" out of the runtime fingerprint. The fingerprint
 * decides which installed builds an OTA update reaches, and a script line is
 * not native surface: editing the `ota` script (2026-09-11) silently changed
 * the fingerprint, and the publish landed on a runtime no installed build
 * reports — reaching nobody.
 *
 * NOTE: this file is itself a fingerprint input, so the skip takes effect at
 * the NEXT store build. Until then, before any OTA publish, verify the local
 * fingerprint matches the latest build's runtime:
 *   npx eas fingerprint:compare <runtime version from `eas build:list`>
 * and if it differs only by script text, publish from a tree matching the
 * build (e.g. the release tag).
 */
const { SourceSkips } = require("@expo/fingerprint");

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll,
};

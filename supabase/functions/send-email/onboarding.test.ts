import { test } from "node:test";
import assert from "node:assert/strict";
import { onboardingCopy, normalizeLang } from "./onboarding.ts";

test("lang falls back to en", () => {
  assert.equal(normalizeLang("de"), "en");
  assert.equal(normalizeLang(undefined), "en");
  assert.equal(normalizeLang("sv"), "sv");
});
test("welcome sv player", () => {
  const c = onboardingCopy("welcome", "sv", "player", "Mustapha");
  assert.equal(c.subject, "Scoutable på din dator");
  assert.equal(c.greeting, "Hej Mustapha,");
  assert.equal(c.roleLine, "Två matcher är gratis. Dra in din matchvideo så tar Scoutable automatiskt fram allt med ditt namn.");
});
test("welcome en no role, no name", () => {
  const c = onboardingCopy("welcome", "en", undefined, undefined);
  assert.equal(c.greeting, null);
  assert.equal(c.roleLine, "Two games are free.");
});
test("reminder en coach", () => {
  const c = onboardingCopy("onboarding_reminder", "en", "coach", "Sam");
  assert.equal(c.subject, "Your two free games are waiting");
  assert.equal(c.unsubscribe, "Unsubscribe from tips and offers");
});
test("player copy never names the mechanism", () => {
  for (const lang of ["sv", "en"] as const)
    for (const kind of ["welcome", "onboarding_reminder"] as const)
      assert.doesNotMatch(onboardingCopy(kind, lang, "player", "A").roleLine, /play-by-play|sync|tip-off/i);
});

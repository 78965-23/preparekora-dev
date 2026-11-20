import {
  firebaseAdminRequest
} from "./firebase-admin.js";

function encodeKey(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getRevealDelay(env) {
  const configured = Number(env.REVEAL_DELAY_HOURS || 6);

  if (
    !Number.isFinite(configured) ||
    configured < 1 ||
    configured > 168
  ) {
    return 6 * 60 * 60 * 1000;
  }

  return configured * 60 * 60 * 1000;
}

export async function handleScheduledReveal(event, env, ctx) {
  const now = Date.now();
  const delayMs = getRevealDelay(env);

  const allSets = await firebaseAdminRequest(
    env,
    "sets"
  );

  if (!allSets || typeof allSets !== "object") {
    console.log("Scheduled reveal: no MCQ sets found.");
    return;
  }

  let revealedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const [databaseKey, set] of Object.entries(allSets)) {
    if (
      !set ||
      typeof set !== "object" ||
      set.status !== "ready" ||
      !set.postedAt ||
      set.revealedAt
    ) {
      skippedCount++;
      continue;
    }

    const postedAt = Number(set.postedAt);

    if (!Number.isFinite(postedAt) || postedAt <= 0) {
      skippedCount++;
      continue;
    }

    const scheduledRevealAt = Number(set.revealAt) > 0
      ? Number(set.revealAt)
      : postedAt + delayMs;

    if (now < scheduledRevealAt) {
      skippedCount++;
      continue;
    }

    try {
      // Recheck the record before updating it.
      const latestSet = await firebaseAdminRequest(
        env,
        `sets/${databaseKey}`
      );

      if (
        !latestSet ||
        latestSet.status !== "ready" ||
        !latestSet.postedAt ||
        latestSet.revealedAt
      ) {
        skippedCount++;
        continue;
      }

      const latestPostedAt = Number(latestSet.postedAt);

      if (
        !Number.isFinite(latestPostedAt) ||
        latestPostedAt <= 0
      ) {
        skippedCount++;
        continue;
      }

      const latestRevealAt = Number(latestSet.revealAt) > 0
        ? Number(latestSet.revealAt)
        : latestPostedAt + delayMs;

      if (now < latestRevealAt) {
        skippedCount++;
        continue;
      }

      await firebaseAdminRequest(
        env,
        `sets/${databaseKey}`,
        "PATCH",
        {
          revealedAt: now,
          revealAt: null,
          revealMethod: "scheduled",
          updatedAt: now
        }
      );

      await firebaseAdminRequest(
        env,
        "activities",
        "POST",
        {
          type: "answers-auto-revealed",
          message: `Automatically revealed answers for ${latestSet.id || databaseKey}`,
          timestamp: now,
          uid: "system"
        }
      );

      revealedCount++;

    } catch (error) {
      failedCount++;

      console.error(
        "Scheduled reveal failed for one MCQ set:",
        error.message
      );
    }
  }

  console.log(
    `Scheduled reveal completed. Revealed: ${revealedCount}, skipped: ${skippedCount}, failed: ${failedCount}.`
  );
}

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureSource } from "../capture/index.js";
import type { VisionProvider } from "../ai/provider.js";
import { prepareImage, sideBySide } from "../image/preprocess.js";
import {
  TROUBLESHOOT_SCHEMA,
  TROUBLESHOOT_SYSTEM,
  troubleshootUserPrompt,
  VERIFY_SCHEMA,
  VERIFY_SYSTEM,
  verifyUserPrompt,
  type RawVerifyJson,
} from "../ai/prompts.js";
import { store } from "../store/store.js";
import type { AppConfig, TroubleshootSession, TroubleshootSuggestion } from "../types.js";

/**
 * Begin an investigation: grab a baseline frame, ask the model to diagnose the
 * reported symptom and propose concrete, *visually verifiable* changes.
 */
export async function startTroubleshoot(
  source: CaptureSource,
  ai: VisionProvider,
  cfg: AppConfig,
  symptom: string,
): Promise<TroubleshootSession> {
  const id = randomUUID().slice(0, 8);
  const raw = await source.grab();
  const prepped = await prepareImage(raw, cfg.image);
  const baselineSnapshot = await store.saveSnapshot(`ts-${id}-baseline`, prepped.bytes);

  const { suggestions } = await ai.json<{ suggestions: TroubleshootSuggestion[] }>({
    system: TROUBLESHOOT_SYSTEM,
    prompt: troubleshootUserPrompt(symptom),
    images: [prepped.base64],
    schema: TROUBLESHOOT_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.2,
  });

  const session: TroubleshootSession = {
    id,
    ts: Date.now(),
    status: "watching",
    symptom,
    baselineSnapshot,
    suggestions: suggestions ?? [],
    observations: [],
    notes: [],
  };
  store.addSession(session);
  return session;
}

/**
 * Verify the outcome of an applied change: capture a fresh frame, place it next
 * to the baseline (before|after), and ask the model whether the problem improved
 * relative to the suggestion's `watchFor` signal.
 */
export async function verifyOutcome(
  source: CaptureSource,
  ai: VisionProvider,
  cfg: AppConfig,
  sessionId: string,
  suggestionIndex = 0,
): Promise<TroubleshootSession> {
  const session = store.getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const afterRaw = await source.grab();
  const suggestion = session.suggestions[suggestionIndex];
  const watchFor = suggestion?.watchFor ?? "the original problem is reduced or gone";

  // Compare against the baseline visually (before|after side by side).
  let prepped;
  if (session.baselineSnapshot) {
    const beforeBytes = await readFile(join(store.snapshotDir(), session.baselineSnapshot.replace("/snapshots/", "")));
    prepped = await sideBySide(beforeBytes, afterRaw, cfg.image);
  } else {
    prepped = await prepareImage(afterRaw, cfg.image);
  }
  const snapshotPath = await store.saveSnapshot(`ts-${session.id}-verify-${session.observations.length}`, prepped.bytes);

  const v = await ai.json<RawVerifyJson>({
    system: VERIFY_SYSTEM,
    prompt: verifyUserPrompt(session.symptom, watchFor),
    images: [prepped.base64],
    schema: VERIFY_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
  });

  session.observations.push({
    ts: Date.now(),
    snapshotPath,
    verdict: v.verdict,
    note: v.note,
  });
  if (v.verdict === "improved") session.status = "resolved";
  else if (v.verdict === "worse") session.status = "failed";
  else session.status = "watching";

  store.updateSession(session);
  return session;
}

import { randomUUID } from "node:crypto";
import type { CaptureSource } from "../capture/index.js";
import type { VisionProvider } from "../ai/provider.js";
import { prepareImage } from "../image/preprocess.js";
import {
  FAILURE_SCHEMA,
  FAILURE_SYSTEM,
  failureUserPrompt,
  type RawFailureJson,
} from "../ai/prompts.js";
import { store } from "../store/store.js";
import type {
  AppConfig,
  CheckResult,
  IssueFinding,
  IssueType,
  SinglePass,
} from "../types.js";

const ISSUE_TYPES: IssueType[] = ["spaghetti", "detached", "blob", "stringing", "layer_shift"];

function rawToPass(raw: RawFailureJson): SinglePass {
  const issues: IssueFinding[] = [];
  for (const t of ISSUE_TYPES) {
    const present = Boolean((raw as unknown as Record<string, boolean>)[t]);
    if (present) {
      issues.push({ type: t, present: true, severity: raw.most_severe === "none" ? "minor" : raw.most_severe, note: "" });
    }
  }
  if (raw.other_problem) {
    issues.push({ type: "other", present: true, severity: raw.most_severe === "none" ? "minor" : raw.most_severe, note: raw.reasoning });
  }
  return {
    failed: Boolean(raw.failed),
    confidence: clamp01(raw.confidence),
    issues,
    reasoning: raw.reasoning ?? "",
  };
}

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Majority vote of samples within one frame. */
function fuseFrame(passes: SinglePass[]): { failed: boolean; confidence: number; issueCounts: Map<IssueType, number> } {
  const failVotes = passes.filter((p) => p.failed).length;
  const failed = failVotes > passes.length / 2;
  const avgConf = passes.reduce((s, p) => s + p.confidence, 0) / passes.length;
  // Confidence reflects vote agreement too: unanimous => keep model conf; split => discount.
  const agreement = Math.max(failVotes, passes.length - failVotes) / passes.length;
  const confidence = clamp01(avgConf * agreement);
  const issueCounts = new Map<IssueType, number>();
  for (const p of passes) {
    if (!p.failed) continue;
    for (const i of p.issues) issueCounts.set(i.type, (issueCounts.get(i.type) ?? 0) + 1);
  }
  return { failed, confidence, issueCounts };
}

/**
 * Run a full double-checked failure inspection:
 *  1. capture `frames` frames spaced `frameDelayMs` apart (cross-frame check)
 *  2. run `samples` model passes per frame (self-consistency vote)
 *  3. a frame counts as "failed" only by sample majority
 *  4. overall verdict requires a majority of FRAMES to fail (transients rejected)
 *  5. low aggregate confidence => verdict "uncertain" (candidate for escalation)
 */
export async function runFailureCheck(
  source: CaptureSource,
  ai: VisionProvider,
  cfg: AppConfig,
  onProgress?: (msg: string) => void,
): Promise<CheckResult> {
  const id = randomUUID().slice(0, 8);
  const ts = Date.now();
  const { samples, frames, frameDelayMs, confidenceThreshold } = cfg.check;

  const allPasses: SinglePass[] = [];
  const snapshotPaths: string[] = [];
  const frameResults: ReturnType<typeof fuseFrame>[] = [];

  for (let f = 0; f < frames; f++) {
    onProgress?.(`Capturing frame ${f + 1}/${frames}…`);
    const raw = await source.grab();
    const prepped = await prepareImage(raw, cfg.image);
    snapshotPaths.push(await store.saveSnapshot(`${id}-f${f}`, prepped.bytes));

    const framePasses: SinglePass[] = [];
    for (let s = 0; s < samples; s++) {
      onProgress?.(`Analyzing frame ${f + 1}, pass ${s + 1}/${samples}…`);
      try {
        const json = await ai.json<RawFailureJson>({
          system: FAILURE_SYSTEM,
          prompt: failureUserPrompt(),
          images: [prepped.base64],
          schema: FAILURE_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0,
        });
        framePasses.push(rawToPass(json));
      } catch (e) {
        // A failed pass abstains rather than poisoning the vote.
        onProgress?.(`pass error: ${(e as Error).message}`);
      }
    }
    if (framePasses.length === 0) throw new Error("all model passes failed for this frame");
    allPasses.push(...framePasses);
    frameResults.push(fuseFrame(framePasses));

    if (f < frames - 1) await sleep(frameDelayMs);
  }

  // Cross-frame fusion: real failures persist across frames.
  const failedFrames = frameResults.filter((r) => r.failed).length;
  const overallFailed = failedFrames > frames / 2;
  const confidence = aggregateConfidence(frameResults, overallFailed);

  // Issues: surface a type if it was flagged in a majority of failed frames.
  const issues = aggregateIssues(frameResults, samples);

  let verdict: CheckResult["verdict"];
  if (confidence < confidenceThreshold) verdict = "uncertain";
  else verdict = overallFailed ? "failed" : "ok";

  const summary = buildSummary(verdict, issues, failedFrames, frames, confidence);

  const result: CheckResult = {
    id,
    ts,
    verdict,
    confidence,
    issues,
    summary,
    framesAnalyzed: frames,
    samplesPerFrame: samples,
    passes: allPasses,
    snapshotPaths,
  };
  store.addCheck(result);
  return result;
}

function aggregateConfidence(frameResults: ReturnType<typeof fuseFrame>[], overallFailed: boolean): number {
  // Average the confidence of the frames that agree with the overall verdict.
  const agreeing = frameResults.filter((r) => r.failed === overallFailed);
  if (agreeing.length === 0) return 0;
  const base = agreeing.reduce((s, r) => s + r.confidence, 0) / agreeing.length;
  // Scale by how many frames agreed (cross-frame consistency).
  const consistency = agreeing.length / frameResults.length;
  return clamp01(base * consistency);
}

function aggregateIssues(frameResults: ReturnType<typeof fuseFrame>[], samples: number): IssueFinding[] {
  const totals = new Map<IssueType, number>();
  const failedFrames = frameResults.filter((r) => r.failed);
  for (const fr of failedFrames) {
    for (const [type, count] of fr.issueCounts) {
      // weight by within-frame agreement
      totals.set(type, (totals.get(type) ?? 0) + count / samples);
    }
  }
  const out: IssueFinding[] = [];
  for (const [type, score] of totals) {
    if (score >= Math.max(1, failedFrames.length) / 2) {
      out.push({ type, present: true, severity: score >= failedFrames.length ? "major" : "minor", note: "" });
    }
  }
  return out.sort((a, b) => (a.severity === "major" ? -1 : 1));
}

function buildSummary(
  verdict: CheckResult["verdict"],
  issues: IssueFinding[],
  failedFrames: number,
  frames: number,
  confidence: number,
): string {
  const pct = Math.round(confidence * 100);
  if (verdict === "ok") return `Print looks healthy across ${frames} frame(s). Confidence ${pct}%.`;
  if (verdict === "uncertain")
    return `Possible problem but not certain (${failedFrames}/${frames} frames, ${pct}% confidence). Worth a human glance${issues.length ? `: ${issues.map((i) => i.type).join(", ")}` : ""}.`;
  const list = issues.length ? issues.map((i) => `${i.type} (${i.severity})`).join(", ") : "an unspecified problem";
  return `Likely FAILURE: ${list}. Seen in ${failedFrames}/${frames} frames, ${pct}% confidence.`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

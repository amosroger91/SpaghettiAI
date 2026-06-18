// Shared types for print-watch.

export interface CameraConfig {
  type: "http-snapshot" | "mjpeg" | "usb" | "folder";
  url?: string;
  usbDevice?: string;
  folderPath?: string;
}

export interface ImageConfig {
  maxSize: number;
  /** [left, top, width, height] in pixels of the ORIGINAL frame, or null for full frame. */
  crop: [number, number, number, number] | null;
  normalize: boolean;
  grayscale: boolean;
}

export interface AiConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
}

export interface CheckConfig {
  samples: number;
  frames: number;
  frameDelayMs: number;
  confidenceThreshold: number;
}

export interface AppConfig {
  server: { port: number; host: string };
  camera: CameraConfig;
  image: ImageConfig;
  ai: AiConfig;
  check: CheckConfig;
}

/** The catalogue of failure modes we ask the model about, one narrow question each. */
export type IssueType =
  | "spaghetti"
  | "detached"
  | "blob"
  | "stringing"
  | "layer_shift"
  | "other";

export interface IssueFinding {
  type: IssueType;
  present: boolean;
  severity: "none" | "minor" | "major";
  note: string;
}

/** Result of a single model pass on a single image. */
export interface SinglePass {
  failed: boolean;
  confidence: number; // 0..1
  issues: IssueFinding[];
  reasoning: string;
}

/** Aggregated result after self-consistency voting + cross-frame fusion. */
export interface CheckResult {
  id: string;
  ts: number;
  verdict: "ok" | "failed" | "uncertain";
  confidence: number;
  issues: IssueFinding[];
  summary: string;
  // bookkeeping for transparency / the double-check UI
  framesAnalyzed: number;
  samplesPerFrame: number;
  passes: SinglePass[];
  snapshotPaths: string[];
}

export interface TroubleshootSuggestion {
  hypothesis: string;
  change: string; // the concrete adjustment to make
  expectedOutcome: string; // what we should SEE if it worked
  watchFor: string; // visual signal to verify against
}

export interface TroubleshootSession {
  id: string;
  ts: number;
  status: "investigating" | "watching" | "resolved" | "failed";
  symptom: string;
  baselineSnapshot?: string;
  suggestions: TroubleshootSuggestion[];
  // verification observations after a change was applied
  observations: {
    ts: number;
    snapshotPath: string;
    verdict: "improved" | "no_change" | "worse" | "unclear";
    note: string;
  }[];
  notes: string[];
}

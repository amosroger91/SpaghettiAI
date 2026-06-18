// Prompts and JSON schemas tuned for SMALL local vision models (e.g. gemma3:4b).
// Principles baked in here:
//   - fixed boolean keys instead of free-form arrays (small models fill fixed
//     slots far more reliably than they invent well-formed object arrays)
//   - each known failure mode gets its own slot => forces explicit consideration
//     (the benefit of decomposition without N separate model calls)
//   - concrete visual definitions so the model knows what each term looks like
//   - explicit "if unsure, say so with low confidence" to curb false alarms

export const FAILURE_SYSTEM = `You are a meticulous 3D-printing failure inspector.
You look at one webcam photo of a printer mid-print and report only what is clearly visible.
Be conservative: shadows, reflections, the moving nozzle, and stray light are NOT failures.
If the image is blurry, dark, or ambiguous, report low confidence rather than guessing.
Answer ONLY with the requested JSON. No prose.`;

// Visual cheat-sheet appended to the user prompt.
const FAILURE_MODES = `Failure modes to look for:
- spaghetti: loose tangled strands of filament in the air or piled up, not attached to a solid object. The classic catastrophic failure.
- detached: the print has come loose from the bed, shifted off its footprint, or is being dragged around.
- blob: a large lump/glob of melted plastic stuck on the nozzle or on top of the print.
- stringing: thin wispy hairs/threads stretched between parts of the print.
- layer_shift: layers abruptly offset sideways so the object looks sheared/staircased.
A clean print in progress looks like a solid, even object growing layer by layer on the bed.`;

export function failureUserPrompt(): string {
  return `Inspect this photo of a 3D print in progress.
${FAILURE_MODES}

For each failure mode, decide if it is clearly present. Set "failed" true only if at least one MAJOR problem is visible. Give your confidence (0=guess, 1=certain) and one short sentence of reasoning.`;
}

export const FAILURE_SCHEMA = {
  type: "object",
  properties: {
    failed: { type: "boolean" },
    confidence: { type: "number" },
    spaghetti: { type: "boolean" },
    detached: { type: "boolean" },
    blob: { type: "boolean" },
    stringing: { type: "boolean" },
    layer_shift: { type: "boolean" },
    other_problem: { type: "boolean" },
    most_severe: { type: "string", enum: ["none", "minor", "major"] },
    reasoning: { type: "string" },
  },
  required: [
    "failed",
    "confidence",
    "spaghetti",
    "detached",
    "blob",
    "stringing",
    "layer_shift",
    "other_problem",
    "most_severe",
    "reasoning",
  ],
} as const;

export interface RawFailureJson {
  failed: boolean;
  confidence: number;
  spaghetti: boolean;
  detached: boolean;
  blob: boolean;
  stringing: boolean;
  layer_shift: boolean;
  other_problem: boolean;
  most_severe: "none" | "minor" | "major";
  reasoning: string;
}

// ---- Troubleshooting (use case 2) ----

export const TROUBLESHOOT_SYSTEM = `You are an expert 3D-printing troubleshooter helping diagnose a failed or failing print from a webcam photo and a description of the symptom.
You propose concrete, testable changes (slicer settings, hardware, filament) and state exactly what a successful outcome would LOOK like in a later photo, so the change can be visually verified.
Be specific and practical. Answer ONLY with the requested JSON.`;

export function troubleshootUserPrompt(symptom: string): string {
  return `The user reports this problem with the print shown: "${symptom}".
Diagnose the most likely causes and propose up to 3 concrete changes, ordered most-likely-to-help first.
For each: a one-line hypothesis, the exact change to make, the expected outcome, and the visual signal to watch for in a later photo to confirm it worked.`;
}

export const TROUBLESHOOT_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hypothesis: { type: "string" },
          change: { type: "string" },
          expectedOutcome: { type: "string" },
          watchFor: { type: "string" },
        },
        required: ["hypothesis", "change", "expectedOutcome", "watchFor"],
      },
    },
  },
  required: ["suggestions"],
} as const;

// ---- Verification (did the change help?) ----

export const VERIFY_SYSTEM = `You compare two webcam photos of a 3D print: BEFORE (left) and AFTER (right) a change was applied.
You judge whether the specific problem improved. Be objective; ignore lighting/angle differences.
Answer ONLY with the requested JSON.`;

export function verifyUserPrompt(symptom: string, watchFor: string): string {
  return `Original problem: "${symptom}".
We applied a change and are checking the result. Success looks like: "${watchFor}".
The image shows BEFORE on the left and AFTER on the right. Did the problem improve?`;
}

export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["improved", "no_change", "worse", "unclear"] },
    confidence: { type: "number" },
    note: { type: "string" },
  },
  required: ["verdict", "confidence", "note"],
} as const;

export interface RawVerifyJson {
  verdict: "improved" | "no_change" | "worse" | "unclear";
  confidence: number;
  note: string;
}

// Prompts and JSON schemas tuned for SMALL local vision models (e.g. gemma3:4b).
// Principles baked in here:
//   - fixed boolean keys instead of free-form arrays (small models fill fixed
//     slots far more reliably than they invent well-formed object arrays)
//   - each known failure mode gets its own slot => forces explicit consideration
//     (the benefit of decomposition without N separate model calls)
//   - concrete visual definitions so the model knows what each term looks like
//   - explicit "if unsure, say so with low confidence" to curb false alarms

export const FAILURE_SYSTEM = `You are a meticulous 3D-printing inspector looking at one webcam photo of a printer mid-print.
Your job is to describe the state of the print honestly. Report only what is clearly visible;
shadows, reflections, the moving nozzle, and stray light are NOT defects.
Answer ONLY with the requested JSON. No prose.`;

// Vivid, contrastive definitions. Small models do best when each option is described by
// what it LOOKS like and how it differs from a clean print.
const FAILURE_MODES = `Decide the overall state of the print:
- "clean": a solid object growing layer by layer on the bed. It may be large, dark, intricate, or have many small parts printing at once — that is still clean as long as each part is a solid shape, not a loose tangle.
- "minor": mostly fine, but small cosmetic defects (a few fine hairs/whiskers, slight roughness).
- "failing": something is clearly wrong. Tell-tale signs:
    * spaghetti: a chaotic bird's-nest of loose, thin plastic strands going in random directions, piled up or waving in the air and NOT forming a solid object. This is plastic filament, the same color as the print.
    * detached: the object has come off the bed, shifted off its base, or is being dragged around.
    * blob: a large lump/glob of melted plastic stuck on the print or nozzle.
    * stringing: many fine plastic threads stretched across or around the print.
    * layer_shift: layers abruptly offset sideways so the object looks sheared.
- "unsure": the image is too dark, blurry, or ambiguous to tell.

IMPORTANT — these are NOT failures:
- The printer's own hardware: wires, cables, ribbon cables, drive belts, gears, threaded rods, the metal frame, hoses, and the nozzle/hotend. These are not filament. Never call machine wiring "spaghetti" or "stringing".
- A normal solid print, even if it is complex, dark, or made of many separate small parts on the bed.
- A thin, sparse, or translucent first layer just starting on the bed.
Only call it spaghetti when you see loose plastic strands that clearly are NOT part of the machine and do NOT form a solid object.`;

export function failureUserPrompt(): string {
  return `Inspect this photo of a 3D print in progress.
${FAILURE_MODES}

Report the overall print_state, the single most prominent issue (primary_issue, or "none"),
how certain you are, and one short sentence describing what you see.`;
}

// Categorical fields only — a 4B model produces these far more reliably than a float
// confidence (which it tends to peg at 0) or a holistic true/false "failed" judgment.
export const FAILURE_SCHEMA = {
  type: "object",
  properties: {
    print_state: { type: "string", enum: ["clean", "minor", "failing", "unsure"] },
    primary_issue: {
      type: "string",
      enum: ["none", "spaghetti", "detached", "blob", "stringing", "layer_shift", "other"],
    },
    certainty: { type: "string", enum: ["low", "medium", "high"] },
    reasoning: { type: "string" },
  },
  required: ["print_state", "primary_issue", "certainty", "reasoning"],
} as const;

export interface RawFailureJson {
  print_state: "clean" | "minor" | "failing" | "unsure";
  primary_issue: "none" | "spaghetti" | "detached" | "blob" | "stringing" | "layer_shift" | "other";
  certainty: "low" | "medium" | "high";
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

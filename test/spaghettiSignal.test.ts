import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGray, DEFAULT_SIGNAL_CFG } from "../src/image/spaghettiSignal.js";

// scoreGray is a pure function of a grayscale buffer — easy to pin with synthetic
// images, so these run instantly with no model or fixtures.

function fill(w: number, h: number, fn: (x: number, y: number) => number): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fn(x, y) & 255;
  return a;
}

test("a flat gray frame has no edges → score 0, likelihood low", () => {
  const g = fill(64, 64, () => 128);
  const s = scoreGray(g, 64, 64, DEFAULT_SIGNAL_CFG);
  assert.equal(s.busyFraction, 0);
  assert.equal(s.score, 0);
  assert.equal(s.likelihood, "low");
});

// Deterministic PRNG so "random" noise is reproducible across runs.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("chaotic random noise is dense AND directionless → high busyFraction and incoherence", () => {
  const rnd = mulberry32(42);
  const g = fill(64, 64, () => (rnd() * 256) | 0);
  const s = scoreGray(g, 64, 64, DEFAULT_SIGNAL_CFG);
  assert.ok(s.busyFraction > 0.5, `busyFraction ${s.busyFraction} should be high`);
  assert.ok(s.incoherence > 0.8, `incoherence ${s.incoherence} should be high`);
  assert.ok(s.score > 0, "score should be > 0");
});

test("regular straight stripes are MORE ordered than random noise (lower incoherence)", () => {
  const rnd = mulberry32(7);
  const stripes = scoreGray(fill(64, 64, (x) => (x % 4 < 2 ? 255 : 0)), 64, 64, DEFAULT_SIGNAL_CFG);
  const noise = scoreGray(fill(64, 64, () => (rnd() * 256) | 0), 64, 64, DEFAULT_SIGNAL_CFG);
  // A printer's straight frame/gantry must read as more ordered than tangled spaghetti.
  assert.ok(stripes.incoherence < noise.incoherence, `stripes ${stripes.incoherence} < noise ${noise.incoherence}`);
});

test("score and likelihood stay within bounds", () => {
  const s = scoreGray(fill(32, 32, (x, y) => (x * 7 + y * 13) % 256), 32, 32, DEFAULT_SIGNAL_CFG);
  assert.ok(s.score >= 0 && s.score <= 1);
  assert.ok(["low", "medium", "high"].includes(s.likelihood));
});

// Generates assets/sounds/offer-tone.wav — the looped offer alert (#15).
//
// 16-bit mono PCM at 22.05 kHz, exactly 1,000 ms: a 150 ms 880 Hz sine (A5)
// with 5 ms linear fades against clicks, then 850 ms of silence. Looped by
// `useOfferAlerts`, that is one beep per second for the card's lifetime.
// Zero dependencies; deterministic, so re-running yields a byte-identical
// file. The pitch and length are cosmetic placeholders logged in
// .claude/references/ui-decisions.md.
//
//   pnpm --filter @taxi/driver make:tone
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22_050;
const DURATION_MS = 1_000;
const TONE_MS = 150;
const FADE_MS = 5;
const FREQUENCY_HZ = 880;
const AMPLITUDE = 0.6; // of full scale; loud enough over road noise, no clipping

const totalSamples = (SAMPLE_RATE * DURATION_MS) / 1000;
const toneSamples = (SAMPLE_RATE * TONE_MS) / 1000;
const fadeSamples = (SAMPLE_RATE * FADE_MS) / 1000;

const pcm = Buffer.alloc(totalSamples * 2);
for (let i = 0; i < toneSamples; i++) {
  const t = i / SAMPLE_RATE;
  let gain = 1;
  if (i < fadeSamples) gain = i / fadeSamples;
  else if (i >= toneSamples - fadeSamples)
    gain = (toneSamples - i) / fadeSamples;
  const sample = Math.sin(2 * Math.PI * FREQUENCY_HZ * t) * AMPLITUDE * gain;
  pcm.writeInt16LE(Math.round(sample * 32_767), i * 2);
}
// The remaining samples stay 0 — the 850 ms of silence.

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM format
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../assets/sounds/offer-tone.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${header.length + pcm.length} bytes)`);

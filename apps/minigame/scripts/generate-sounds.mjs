import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sampleRate = 12_000;

const sounds = {
  "select.wav": [{ frequency: 720, duration: 0.045, volume: 0.2 }, { frequency: 960, duration: 0.035, volume: 0.16 }],
  "action.wav": [{ frequency: 330, duration: 0.055, volume: 0.22 }, { frequency: 495, duration: 0.07, volume: 0.2 }],
  "nope.wav": [{ frequency: 220, duration: 0.07, volume: 0.3 }, { frequency: 165, duration: 0.09, volume: 0.25 }],
  "danger.wav": [{ frequency: 110, duration: 0.12, volume: 0.32 }, { frequency: 82, duration: 0.14, volume: 0.3 }, { frequency: 55, duration: 0.18, volume: 0.26 }],
};

await mkdir(resolve(root, "assets/sounds"), { recursive: true });
for (const [name, notes] of Object.entries(sounds)) {
  await writeFile(resolve(root, "assets/sounds", name), makeWave(notes));
}
console.log(`Generated ${Object.keys(sounds).length} original mini-game sounds.`);

function makeWave(notes) {
  const gapSamples = Math.floor(sampleRate * 0.008);
  const samples = [];
  for (const note of notes) {
    const count = Math.floor(sampleRate * note.duration);
    for (let index = 0; index < count; index += 1) {
      const envelope = Math.sin(Math.PI * index / count) ** 1.5;
      const fundamental = Math.sin(2 * Math.PI * note.frequency * index / sampleRate);
      const harmonic = Math.sin(4 * Math.PI * note.frequency * index / sampleRate) * 0.18;
      samples.push(Math.round(32767 * note.volume * envelope * (fundamental + harmonic)));
    }
    samples.push(...new Array(gapSamples).fill(0));
  }
  const dataBytes = samples.length * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => output.writeInt16LE(sample, 44 + index * 2));
  return output;
}

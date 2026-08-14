import * as WebAudio from 'node-web-audio-api';
for (const [k, v] of Object.entries(WebAudio)) if (typeof v === 'function' && !globalThis[k]) globalThis[k] = v;
const Tone = (await import('tone')).default;
const ac = new WebAudio.AudioContext();
const ctx = new Tone.Context(ac);
Tone.setContext(ctx);
try { new Tone.Gain(); console.log('Tone.Gain OK'); } catch (e) { console.log('Tone.Gain FAIL:', e.message); }
try { new Tone.Filter(10000, 'highshelf'); console.log('Tone.Filter OK'); } catch (e) { console.log('Tone.Filter FAIL:', e.message); }
try {
  const buf = ac.createBuffer(1, 1024, 44100);
  const s = new Tone.Sampler({ urls: { 60: buf } });
  console.log('Tone.Sampler OK');
} catch (e) { console.log('Tone.Sampler FAIL:', e.message); }
setTimeout(() => process.exit(0), 500);

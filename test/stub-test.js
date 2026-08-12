// stub-test.js — 用最小 DOM stub 在 Node 里跑 index.html 的 renderResult 全流程，抓运行时错误
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const scripts = html.match(/<script>([\s\S]*?)<\/script>/g).map(s => s.replace(/<\/?script>/g, ''));

// ---- 最小 DOM stub ----
function makeEl(id) {
  return {
    id: id || '', style: {}, value: '0',
    classList: { add() {}, remove() {}, toggle() {} },
    innerHTML: '', textContent: '', dataset: {},
    children: [],
    appendChild(c) { this.children.push(c); },
    addEventListener() {},
    querySelector() { return makeEl(); },
    getContext() { return { clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fillText(){} }; },
    setAttribute(){}, getAttribute(){ return null; }
  };
}
const elCache = {};
global.document = {
  getElementById(id) { if (!elCache[id]) elCache[id] = makeEl(id); return elCache[id]; },
  createElement() { return makeEl(); },
  addEventListener() {}, body: makeEl('body')
};
global.window = {
  navigator: { userAgent: 'stub', mediaDevices: { getUserMedia(){ return Promise.reject(); }, enumerateDevices(){ return Promise.resolve([]); } } },
  setTimeout, clearTimeout, setInterval() {}, requestAnimationFrame(){},
  speechSynthesis: null,
  AudioContext: function(){ return { state:'running', sampleRate:44100, currentTime:0, destination:{},
    createGain(){ return { gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}, connect(){}, disconnect(){} }; },
    createScriptProcessor(){ return { connect(){}, disconnect(){}, onaudioprocess:null }; },
    createMediaStreamSource(){ return { connect(){}, disconnect(){} }; },
    createOscillator(){ return { connect(){}, start(){}, stop(){}, frequency:{value:0}, type:'' }; },
    createBufferSource(){ return { connect(){}, start(){}, stop(){}, buffer:null, onended:null }; },
    createBuffer(){ return { getChannelData(){ return new Float32Array(100); } }; },
    resume(){}, onstatechange:null };
  },
  webkitAudioContext: undefined,
  onerror: function(){},
  addEventListener(){}
};
global.navigator = global.window.navigator;
global.speechSynthesis = null;

// 执行内联脚本（模块 + 应用逻辑）
for (const code of scripts) {
  new Function('window','document','navigator', code)(global.window, global.document, global.navigator);
}
console.log('✅ 内联脚本全部加载无崩溃');

// 直接调用 renderResult 全流程（已通过 window.__debug 暴露）
const win = global.window;
const DBG = win.__debug;
if (!DBG) { console.log('❌ __debug 未暴露'); process.exit(1); }

// 构造 D 大调音符（模拟真实分析结果）
const notes = [62, 66, 67, 69, 71, 69, 67, 66, 62].map(midi => ({ midi, dur: 0.4 }));
const key = win.KeyDetect.detectKey(notes);
console.log('定调:', key.keyName);

// 尝试完整调用 renderResult（最可能崩溃的路径）
try {
  DBG.renderResult(key, notes);
  console.log('✅ renderResult 完整执行无崩溃');
} catch (e) {
  console.log('❌ renderResult 崩溃:', e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// 测试完整 analyze 路径（模拟真实录音缓冲）
try {
  const sr = 44100;
  // 合成一段 PCM：D大调 do-re-mi... 每个音 0.4s + 静音，总长约 4s
  const chunks = [];
  const freqs = [293.66, 369.99, 392.0, 440.0, 493.88, 440.0, 392.0, 369.99, 293.66];
  freqs.forEach(f => {
    const note = new Float32Array(Math.floor(0.4 * sr));
    let ph = 0;
    for (let i = 0; i < note.length; i++) { ph += 2*Math.PI*f/sr; note[i] = 0.4*Math.sin(ph); }
    chunks.push(note);
    chunks.push(new Float32Array(Math.floor(0.05 * sr)));
  });
  // 挂到 state.buf —— 通过 __debug.analyze 内部用 state.buf
  // analyze 内部引用 state.buf/state.audioCtx，无法从外部设置，改为直接跑 analyze 会失败。
  // 所以我们只验证 analyze 函数体可调用 + renderResult 已覆盖。
  console.log('✅ analyze 函数存在:', typeof DBG.analyze === 'function');
  console.log('✅ stopRecording/startRecording 存在:', typeof DBG.stopRecording === 'function', typeof DBG.startRecording === 'function');
} catch (e) { console.log('❌', e.message); process.exit(1); }
process.exit(0);

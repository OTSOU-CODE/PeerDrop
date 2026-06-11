'use strict';

import { audioCtx, setAudioCtx } from './state.js';

function initAudio() {
  let ctx = audioCtx;
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); setAudioCtx(ctx); } catch (_) { return; }
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}
function playSound(type) {
  initAudio();
  const ctx = audioCtx;
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  if (type === 'pop') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'whoosh') {
    osc.type = 'triangle'; osc.frequency.setValueAtTime(150, now); osc.frequency.linearRampToValueAtTime(400, now + 0.2);
    gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'chime') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
    gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start(now); osc.stop(now + 0.5);
  } else if (type === 'error') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
    gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now); osc.stop(now + 0.15);
  }
}

export { playSound };

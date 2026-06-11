'use strict';

import { $ } from './state.js';

function initParticles() {
  const c = $('particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H;
  const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
  resize(); window.addEventListener('resize', resize);

  const pts = [];
  let isAnimating = false;

  window.triggerParticleBurst = (x, y) => {
    for(let i=0; i<30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 1;
      pts.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        r: Math.random() * 2 + 1.5, a: 1.0, decay: Math.random() * 0.02 + 0.01
      });
    }
    if (!isAnimating) {
      isAnimating = true;
      frame();
    }
  };

  function frame() {
    ctx.clearRect(0,0,W,H);
    if (pts.length === 0) {
      isAnimating = false;
      return;
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(14, 165, 233,${p.a})`; ctx.fill();
      p.x+=p.vx; p.y+=p.vy;
      if (p.decay) {
        p.a -= p.decay;
        if (p.a <= 0) { pts.splice(i, 1); }
      }
    }
    requestAnimationFrame(frame);
  }
}

export { initParticles };

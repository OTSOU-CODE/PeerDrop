'use strict';

import {
  $, show, hide, triggerInputShake,
  MY_ID, MY_NAME, setMY_NAME, savedName,
  peer, role, hostConn, guestConns, localStream, setLocalStream,
  notificationsEnabled, setNotificationsEnabled
} from './state.js';
import { playSound } from './audio.js';
import { initParticles } from './particles.js';
import {
  showToast, showLoading, hideLoading,
  showDragOverlay, hideDragOverlay,
  setConnBar, notify
} from './ui.js';
import {
  handleFilesSelected, handleDrop, handlePaste,
  addVideoStream
} from './files.js';
import { sendChatMessage, handleTyping } from './chat.js';
import {
  initPeer, cleanupPeerResources,
  stopScreenShare, handleCall
} from './peer.js';
import { dbGet, dbSet } from './db.js';
import { chatHistory, allKnownFiles } from './state.js';
import { addChatToFeed } from './chat.js';
import { addFileToFeed } from './files.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
document.fonts?.ready.then(() => { document.body.classList.add('fonts-loaded'); });

initParticles();

document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-primary');
  if (!btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'btn-ripple';
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

const scrollBtn = $('scroll-bottom-btn');
if (scrollBtn) {
  scrollBtn.addEventListener('click', () => {
    const feed = $('file-feed');
    if (feed) { feed.scrollTop = feed.scrollHeight; }
  });
}
document.addEventListener('scroll', e => {
  if (e.target.id !== 'file-feed') return;
  const btn = $('scroll-bottom-btn');
  if (!btn) return;
  const threshold = 120;
  const isNearBottom = e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight < threshold;
  btn.classList.toggle('show', !isNearBottom);
}, true);

function validateName() {
  const inputName = $('input-display-name');
  if (inputName) {
    const val = inputName.value.trim();
    if (!val) {
      triggerInputShake(inputName);
      showToast("Please enter your display name.", "error");
      playSound('error');
      return false;
    }
    setMY_NAME(val);
    localStorage.setItem('peerdrop_name', MY_NAME);
  }
  return true;
}

const nameInput = $('input-display-name');
if (nameInput) {
  nameInput.value = savedName || '';
  nameInput.addEventListener('input', e => {
    setMY_NAME(e.target.value.trim() || 'Guest_' + Math.floor(Math.random() * 1000));
    localStorage.setItem('peerdrop_name', MY_NAME);
  });
}

const notifBtn = $('notif-btn');
if (notifBtn) {
  notifBtn.setAttribute('aria-pressed', 'false');
  const toggleNotif = () => {
    if (!("Notification" in window)) { showToast('Notifications not supported.', 'error'); return; }
    if (Notification.permission === 'granted') {
      setNotificationsEnabled(!notificationsEnabled);
      notifBtn.textContent = notificationsEnabled ? '🔔' : '🔕';
      notifBtn.setAttribute('aria-pressed', String(notificationsEnabled));
      showToast(notificationsEnabled ? 'Notifications enabled!' : 'Notifications muted.', 'info');
      return;
    }
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        setNotificationsEnabled(true);
        notifBtn.textContent = '🔔';
        notifBtn.setAttribute('aria-pressed', 'true');
        showToast('Desktop notifications enabled!', 'success');
      }
    });
  };
  notifBtn.addEventListener('click', toggleNotif);
  notifBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNotif(); } });
}

window.addEventListener('paste', handlePaste);

$('btn-create-room')?.addEventListener('click', () => {
  if (validateName()) initPeer(true, MY_ID);
});

$('btn-join-room')?.addEventListener('click', () => {
  if (!validateName()) return;
  const code = $('input-join-code')?.value.toUpperCase().trim();
  if (code && code.length >= 4) {
    const joinErr = $('join-error');
    if (joinErr) joinErr.hidden = true;
    initPeer(false, code);
  }
});

const hashId = window.location.hash.replace('#', '').toUpperCase().trim();
if (hashId.length >= 4) {
  const joinCode = $('input-join-code');
  if (joinCode) joinCode.value = hashId;
  const saved = localStorage.getItem('peerdrop_name');
  if (saved && saved.trim().length > 0) {
    showToast('Joining room from shared link...', 'info');
    setTimeout(() => initPeer(false, hashId), 300);
  } else {
    show('home-view'); hide('room-view');
  }
} else {
  show('home-view'); hide('room-view');
}

$('btn-leave-room')?.addEventListener('click', () => {
  cleanupPeerResources();
  window.location.hash = '';
  window.location.reload();
});

if (window.location.protocol === 'file:') {
  const warn = document.createElement('div');
  warn.style = "background: #ef4444; color: white; text-align: center; padding: 10px; font-weight: bold; position: fixed; top: 0; left: 0; right: 0; z-index: 9999;";
  warn.innerHTML = "⚠️ You are opening this file directly from your hard drive (file://). Browsers block WebRTC connections this way! <br/> Please push to GitHub Pages or use a local HTTP server.";
  document.body.appendChild(warn);
}

$('btn-copy-link')?.addEventListener('click', () => {
  const rcd = $('room-code-display');
  if (!rcd) return;
  const url = `${location.origin}${location.pathname}#${rcd.textContent}`;
  navigator.clipboard.writeText(url).then(() => {
    const bcl = $('btn-copy-link');
    if (bcl) { bcl.textContent = 'Copied!'; setTimeout(() => { bcl.textContent = 'Copy Link'; }, 2000); }
  }).catch(() => showToast("Failed to copy link", "error"));
});

// ── Theme Toggle ─────────────────────────────────────────────────────────
const themeBtn = $('btn-theme');
if (themeBtn) {
  const saved = localStorage.getItem('peerdrop_theme');
  if (saved === 'light') { document.documentElement.setAttribute('data-theme', 'light'); themeBtn.textContent = '☀️'; }
  themeBtn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) { document.documentElement.removeAttribute('data-theme'); themeBtn.textContent = '🌙'; localStorage.setItem('peerdrop_theme', 'dark'); }
    else { document.documentElement.setAttribute('data-theme', 'light'); themeBtn.textContent = '☀️'; localStorage.setItem('peerdrop_theme', 'light'); }
  });
}

// ── QR Code ──────────────────────────────────────────────────────────────
$('btn-qr')?.addEventListener('click', () => {
  const wrap = $('qr-wrap');
  if (!wrap) return;
  const shown = !wrap.hidden;
  wrap.hidden = !shown;
  if (!shown) {
    const rcd = $('room-code-display');
    if (!rcd) return;
    const url = `${location.origin}${location.pathname}#${rcd.textContent}`;
    const canvas = $('qr-canvas');
    if (canvas) drawQR(url, canvas);
  }
});
function drawQR(text, canvas) {
  const ctx=canvas.getContext('2d');const cw=canvas.width;
  const enc=new TextEncoder().encode(text);
  const v=text.length<10?2:text.length<25?3:text.length<47?4:text.length<77?5:6;
  const n=17+v*4;const ms=cw/n;
  const LOG=[],EXP=[256];for(let i=0;i<255;i++){LOG[i]=0;EXP[i+1]=EXP[i]*2;if(EXP[i+1]>255)EXP[i+1]^=285}
  for(let i=0;i<255;i++)LOG[EXP[i]]=i;
  const mul=(a,b)=>(!a||!b)?0:EXP[(LOG[a]+LOG[b])%255];
  const rs=(data,ecLen)=>{const gen=[1],m=data.slice();for(let i=0;i<ecLen;i++){const t=gen.map(g=>mul(g,2));(gen.push(0));for(let j=0;j<gen.length;j++)gen[j]^=t[j]||0}
    m.push(...new Array(ecLen).fill(0));for(let i=0;i<data.length;i++){if(!m[i])continue;const f=LOG[m[i]];for(let j=0;j<gen.length;j++)m[i+j]^=EXP[(LOG[gen[j]]+f)%255]}
    return m.slice(data.length)};
  const ecLen=[10,15,20,26,30,36][v-2];const codes=enc.length;const pad=Math.ceil(codes/255)*255-codes;
  const ec=rs([...enc,...new Array(pad).fill(0)],ecLen);
  const all=[...enc,...ec];const m=Array.from({length:n},()=>Array(n).fill(0));
  const fp=(r,c)=>{for(let R=0;R<7;R++)for(let C=0;C<7;C++)if(R==0||R==6||C==0||C==6||R>1&&R<5&&C>1&&C<5)m[r+R][c+C]=1}
  fp(0,0);fp(0,n-7);fp(n-7,0);
  for(let i=8;i<n-8;i++){m[6][i]=i%2?0:1;m[i][6]=i%2?0:1}
  const sep=[[0,7],[0,n-8],[7,0],[n-8,0]];
  for(const[r,c]of sep)for(let R=-1;R<8;R++)for(let C=-1;C<8;C++){const y=r+R,x=c+C;if(y>=0&&y<n&&x>=0&&x<n&&(R<0||R>6||C<0||C>6))m[y][x]=0}
  const fmt=0b1010100000010;for(let i=0;i<15;i++){const b=(fmt>>i)&1;if(i<6)m[8][i]=b;else if(i<8)m[15-i][8]=b;else m[n-15+i][8]=b}
  const bits=[];bits.push(1,0,0,0);const bl=enc.length.toString(2).padStart(8,'0');for(const c of bl)bits.push(+c);
  for(const b of enc)for(let i=7;i>=0;i--)bits.push((b>>i)&1);
  while(bits.length%8)bits.push(0);
  const allBits=[];for(const b of all)for(let i=7;i>=0;i--)allBits.push((b>>i)&1);
  let di=0;let dir=-1;
  for(let c=n-1;c>0;c-=2){if(c==6)c--;let r=dir<0?n-1:0;while(r>=0&&r<n){for(const dc of[0,-1]){const x=c+dc;if(m[r][x]!==0||x==6||r==6)continue;m[r][x]=di<bits.length?bits[di++]:(di<bits.length+allBits.length?allBits[di++-bits.length]:0)}r+=dir}dir*=-1}
  ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,cw);
  ctx.fillStyle='#07080b';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(m[y][x])ctx.fillRect(x*ms,y*ms,Math.ceil(ms),Math.ceil(ms));
  wrap.hidden=false;
}

const roomView = $('room-view');
const fileInput = $('room-file-input');

document.addEventListener('dragend', () => hideDragOverlay());
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget || e.relatedTarget === document.documentElement) hideDragOverlay();
});

roomView.addEventListener('dragover', e => { e.preventDefault(); roomView.classList.add('drag-active'); showDragOverlay(); });
roomView.addEventListener('dragleave', e => {
  if (e.relatedTarget && roomView.contains(e.relatedTarget)) return;
  roomView.classList.remove('drag-active'); hideDragOverlay();
});
roomView.addEventListener('drop', handleDrop);

$('btn-attach')?.addEventListener('click', () => { if (fileInput) fileInput.click(); });
if (fileInput) {
  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) handleFilesSelected(e.target.files);
    fileInput.value = '';
  });
}

$('btn-send-chat')?.addEventListener('click', sendChatMessage);
const chatInput = $('chat-input');
if (chatInput) {
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChatMessage();
    else handleTyping();
  });
}

// ── Persistence Restore ──────────────────────────────────────────────────
(async () => {
  const savedChat = await dbGet('chatHistory');
  if (savedChat) { savedChat.forEach(m => { chatHistory.push(m); }); }
  const savedFiles = await dbGet('files');
  if (savedFiles) { savedFiles.forEach(([id, f]) => { allKnownFiles.set(id, f); }); }
})();

const btnShareScreen = $('btn-share-screen');
if (btnShareScreen) {
  btnShareScreen.addEventListener('click', async () => {
    if (!localStream) {
      try {
        let newStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        setLocalStream(newStream);
        addVideoStream(MY_ID, newStream, true);

        if (role === 'host') {
          for (const [guestId] of guestConns) {
            try {
              const call = peer.call(guestId, newStream);
              if (call) handleCall(call);
            } catch (_) {}
          }
        } else if (hostConn && hostConn.open) {
          try {
            const call = peer.call(hostConn.peer, newStream);
            if (call) handleCall(call);
          } catch (_) {}
        }

        newStream.getVideoTracks()[0].onended = () => stopScreenShare();
        btnShareScreen.style.color = '#ef4444';
      } catch (err) {
        showToast("Screen share cancelled or failed.", "error");
      }
    } else {
      stopScreenShare();
    }
  });
}

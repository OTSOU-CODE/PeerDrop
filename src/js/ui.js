'use strict';

import {
  $, escapeHTML, notificationsEnabled,
  roomMembers, MY_ID, role, getAvatarParams
} from './state.js';

let originalTitle = document.title;
let alertInterval = null;
let isAlerting = false;

function flashTabTitle(msg) {
  if (!document.hidden) return;
  if (isAlerting) clearInterval(alertInterval);
  isAlerting = true;
  let toggle = false;
  alertInterval = setInterval(() => {
    document.title = toggle ? `(1) ${msg}` : originalTitle;
    toggle = !toggle;
  }, 1000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isAlerting) {
    clearInterval(alertInterval);
    document.title = originalTitle;
    isAlerting = false;
  }
});

function setConnBar(state, text) {
  const bar = $('conn-bar');
  if (!bar) return;
  bar.className = 'room-enter room-enter-n1';
  if (state === 'weak') bar.classList.add('weak');
  else if (state === 'error') bar.classList.add('error');
  const txt = bar.querySelector('#conn-bar-text');
  if (txt) txt.textContent = text || 'Connected';
}

function showLoading(text = 'Connecting to room...') {
  const overlay = $('loading-overlay');
  if (!overlay) return;
  const txt = overlay.querySelector('.loading-text');
  if (txt) txt.textContent = text;
  overlay.classList.add('show');
}

function hideLoading() {
  const overlay = $('loading-overlay');
  if (overlay) overlay.classList.remove('show');
}

function showDragOverlay() {
  const overlay = $('drag-overlay');
  if (overlay) overlay.classList.add('show');
}

function hideDragOverlay() {
  const overlay = $('drag-overlay');
  if (overlay) overlay.classList.remove('show');
}

function showToast(message, type = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const emojiMap = { error: '❌', success: '✅', info: 'ℹ️' };
  const emojiSpan = document.createElement('span');
  emojiSpan.className = 'toast-emoji';
  emojiSpan.textContent = emojiMap[type] || 'ℹ️';
  t.appendChild(emojiSpan);
  t.appendChild(document.createTextNode(' '));
  const msgDiv = document.createElement('div');
  msgDiv.textContent = message;
  t.appendChild(msgDiv);
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 500);
  }, 4000);
}

function notify(title, body) {
  flashTabTitle(title);
  if (notificationsEnabled && document.hidden) {
    new Notification(title, { body });
  }
}

function renderUserList() {
  const list = $('user-list');
  if (!list) return;
  list.innerHTML = '';

  roomMembers.forEach((data, id) => {
    const isMe = id === MY_ID;
    const av = getAvatarParams(id);
    const div = document.createElement('div');
    div.className = 'participant-row';

    const dot = document.createElement('span');
    dot.className = 'status-dot';
    div.appendChild(dot);
    const avEl = document.createElement('div');
    avEl.className = 'avatar';
    avEl.style.cssText = 'background:' + av.bg + ';width:30px;height:30px;font-size:.7rem';
    avEl.textContent = av.letter;
    div.appendChild(avEl);
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'flex:1;min-width:0';
    const nameEl = document.createElement('div');
    nameEl.className = 'participant-name';
    nameEl.textContent = data.name;
    nameWrap.appendChild(nameEl);
    div.appendChild(nameWrap);
    if (isMe) {
      const tag = document.createElement('span');
      tag.className = 'participant-tag you';
      tag.textContent = 'You';
      div.appendChild(tag);
    }
    if (role === 'host' && id === MY_ID) {
      const tag = document.createElement('span');
      tag.className = 'participant-tag host';
      tag.textContent = 'Host';
      div.appendChild(tag);
    }
    list.appendChild(div);
  });
}

export {
  setConnBar, showLoading, hideLoading,
  showDragOverlay, hideDragOverlay,
  showToast, notify, renderUserList, flashTabTitle
};

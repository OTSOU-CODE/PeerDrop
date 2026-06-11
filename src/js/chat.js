'use strict';

import {
  $, hide, escapeHTML, getAvatarParams,
  MY_ID, MY_NAME, role, hostConn, chatHistory,
  roomMembers, typingTimer, setTypingTimer, triggerInputShake, broadcast
} from './state.js';
import { playSound } from './audio.js';
import { showToast, notify } from './ui.js';
import { dbSet } from './db.js';
import { encryptText, decryptText } from './crypto.js';

const chatInput = $('chat-input');

function renderMarkdownToDOM(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const escaped = escapeHTML(text);
  let i = 0;
  function flush(buf) { if (buf.length) { frag.appendChild(document.createTextNode(buf.join(''))); buf.length = 0; } }
  function build(buf) {
    const stack = [[frag, buf]];
    while (stack.length) {
      const [parent, arr] = stack.pop();
      let j = 0;
      let textBuf = [];
      while (j < arr.length) {
        const item = arr[j];
        if (typeof item === 'string') { textBuf.push(item); j++; continue; }
        flush(textBuf);
        const el = item.el;
        if (item.children) stack.push([el, item.children]);
        parent.appendChild(el);
        j++;
      }
      flush(textBuf);
      parent.normalize();
    }
  }

  let buf = [];
  while (i < escaped.length) {
    if (escaped[i] === '*' && escaped[i+1] === '*') {
      const end = escaped.indexOf('**', i+2);
      if (end !== -1) {
        flush(buf);
        const strong = document.createElement('strong');
        strong.textContent = escaped.slice(i+2, end);
        frag.appendChild(strong);
        i = end + 2; continue;
      }
    }
    if (escaped[i] === '*' && escaped[i+1] !== '*') {
      const end = escaped.indexOf('*', i+1);
      if (end !== -1) {
        flush(buf);
        const em = document.createElement('em');
        em.textContent = escaped.slice(i+1, end);
        frag.appendChild(em);
        i = end + 1; continue;
      }
    }
    if (escaped[i] === '`' && escaped[i+1] === '`' && escaped[i+2] === '`') {
      const end = escaped.indexOf('```', i+3);
      if (end !== -1) {
        flush(buf);
        const pre = document.createElement('pre');
        pre.style.cssText = 'background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;margin:4px 0;font-family:\'JetBrains Mono\',monospace';
        const code = document.createElement('code');
        code.style.cssText = "font-family:'JetBrains Mono',monospace";
        code.textContent = escaped.slice(i+3, end);
        pre.appendChild(code);
        frag.appendChild(pre);
        i = end + 3; continue;
      }
    }
    if (escaped[i] === '`') {
      const end = escaped.indexOf('`', i+1);
      if (end !== -1) {
        flush(buf);
        const code = document.createElement('code');
        code.style.cssText = "background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;font-family:'JetBrains Mono',monospace";
        code.textContent = escaped.slice(i+1, end);
        frag.appendChild(code);
        i = end + 1; continue;
      }
    }
    const urlMatch = escaped.slice(i).match(/^(https?:\/\/[^\s<]+)/);
    if (urlMatch) {
      flush(buf);
      const a = document.createElement('a');
      a.href = urlMatch[0].replace(/&amp;/g, '&');
      a.target = '_blank'; a.rel = 'noopener';
      a.style.cssText = 'color:var(--accent);text-decoration:underline';
      a.textContent = urlMatch[0];
      frag.appendChild(a);
      i += urlMatch[0].length; continue;
    }
    buf.push(escaped[i]);
    i++;
  }
  flush(buf);
  return frag;
}

const parseMarkdown = renderMarkdownToDOM;

async function addChatToFeed(msg) {
  hide('empty-feed-msg');
  const feed = $('file-feed');
  const isMine = msg.senderId === MY_ID;
  const displayName = msg.senderName || msg.senderId;
  const av = getAvatarParams(msg.senderId);
  const displayText = await decryptText(msg.text);

  if (!isMine) {
    notify(`New message from ${escapeHTML(displayName)}`, displayText);
    playSound('pop');
  }

  const div = document.createElement('div');
  div.className = 'feed-item';
  div.style.cssText = 'display:flex;flex-direction:' + (isMine ? 'row-reverse' : 'row') + ';align-items:flex-end;gap:8px;margin-bottom:14px';

  const msgTime = msg.time || Date.now();
  const delta = Date.now() - msgTime;
  const timeStr = delta < 60000 ? 'just now' : delta < 3600000 ? Math.round(delta / 60000) + 'm ago' : delta < 86400000 ? Math.round(delta / 3600000) + 'h ago' : new Date(msgTime).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.cssText = 'background:' + av.bg + ';width:28px;height:28px;font-size:.6rem';
  avatar.textContent = av.letter;
  div.appendChild(avatar);

  const msgCol = document.createElement('div');
  msgCol.style.cssText = 'display:flex;flex-direction:column;align-items:' + (isMine ? 'flex-end' : 'flex-start') + ';max-width:80%';

  const meta = document.createElement('span');
  meta.className = 'chat-meta';
  const metaName = document.createElement('span');
  metaName.className = 'chat-meta-name';
  metaName.textContent = isMine ? 'You' : displayName;
  meta.appendChild(metaName);
  meta.appendChild(document.createTextNode(' · ' + timeStr));
  msgCol.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + (isMine ? 'chat-bubble-own' : 'chat-bubble-other');
  bubble.style.cssText = 'color:#fff;padding:10px 14px;border-radius:14px;word-wrap:break-word;font-size:.95rem;line-height:1.5';
  bubble.appendChild(renderMarkdownToDOM(displayText));
  msgCol.appendChild(bubble);
  div.appendChild(msgCol);
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return displayText;
}

function showTypingIndicator(id) {
  const ind = $('typing-indicator');
  const name = roomMembers.get(id)?.name || id;
  ind.textContent = `${name} is typing...`;
  clearTimeout(typingTimer);
  setTypingTimer(setTimeout(() => { ind.textContent = ''; }, 3000));
}

function handleTyping() {
  if (!chatInput) return;
  const msg = { type: 'typing', senderId: MY_ID };
  if (role === 'host') broadcast(msg);
  else if (hostConn && hostConn.open) hostConn.send(msg);
}

async function sendChatMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) {
    triggerInputShake(chatInput);
    playSound('error');
    return;
  }

  if (role !== 'host' && (!hostConn || !hostConn.open)) {
    showToast("Not connected to the room yet!", "error");
    triggerInputShake(chatInput);
    return;
  }

  chatInput.value = '';
  chatInput.focus();
  playSound('pop');

  const msg = { type: 'chat', text, senderId: MY_ID, senderName: MY_NAME, time: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > 100) chatHistory.shift();
  dbSet('chatHistory', chatHistory.slice(-50));
  addChatToFeed(msg);

  const wireMsg = { ...msg, text: await encryptText(text) };
  if (role === 'host') {
    broadcast(wireMsg);
  } else {
    hostConn.send(wireMsg);
  }
}

export { addChatToFeed, renderMarkdownToDOM, sendChatMessage, showTypingIndicator, parseMarkdown, handleTyping };

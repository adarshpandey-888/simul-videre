// ════════════════════════════════════════════
//   FIREBASE INIT
// ════════════════════════════════════════════
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ════════════════════════════════════════════
//   STATE
// ════════════════════════════════════════════
let state = {
  name     : '',
  roomCode : '',
  isHost   : false,
  memberId : null,
};

let player    = null;
let roomRef   = null;
let isSyncing = false;

// ════════════════════════════════════════════
//   INTRO → LOBBY (FIX)
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const intro = document.getElementById('intro-screen');
  const lobby = document.getElementById('lobby');

  // Lobby seedha block pe set karo, opacity 0
  lobby.style.display  = 'block';
  lobby.style.opacity  = '0';
  lobby.style.transition = 'opacity 0.7s ease';

  // 2.8 sec baad intro fade out
  setTimeout(() => {
    intro.style.transition = 'opacity 0.6s ease';
    intro.style.opacity    = '0';

    // 0.6 sec baad intro hide, lobby show
    setTimeout(() => {
      intro.style.display = 'none';
      lobby.style.opacity = '1';
    }, 600);

  }, 2800);
});

// ════════════════════════════════════════════
//   YOUTUBE API READY
// ════════════════════════════════════════════
function onYouTubeIframeAPIReady() {
  console.log('YouTube ready!');
}

// ════════════════════════════════════════════
//   HELPERS
// ════════════════════════════════════════════
function genCode() {
  return 'YT-' + Math.floor(1000 + Math.random() * 9000);
}

function toast(message) {
  const t = document.getElementById('toast');
  t.textContent    = message;
  t.style.display  = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function extractVideoId(url) {
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ════════════════════════════════════════════
//   CREATE ROOM
// ════════════════════════════════════════════
function createRoom() {
  const name = document.getElementById('host-name').value.trim();
  if (!name) { toast('⚠️ Pehle apna naam likho!'); return; }

  state.name     = name;
  state.roomCode = genCode();
  state.isHost   = true;
  state.memberId = 'host';

  roomRef = db.ref('rooms/' + state.roomCode);
  roomRef.set({
    host        : name,
    videoId     : null,
    playing     : false,
    currentTime : 0,
    createdAt   : Date.now()
  });

  roomRef.child('members').child('host').set({ name, online: true });
  roomRef.child('members').child('host').onDisconnect().update({ online: false });

  listenToRoom();
  showRoom();
  toast('✅ Room ready! Code share karo: ' + state.roomCode);
}

// ════════════════════════════════════════════
//   JOIN ROOM
// ════════════════════════════════════════════
function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();

  if (!name) { toast('⚠️ Apna naam likho!'); return; }
  if (!code) { toast('⚠️ Room code daalo!'); return; }

  state.name     = name;
  state.roomCode = code;
  state.isHost   = false;
  state.memberId = 'guest_' + Date.now();

  roomRef = db.ref('rooms/' + code);

  roomRef.once('value', (snapshot) => {
    if (!snapshot.exists()) {
      toast('❌ Room nahi mila! Code dobara check karo.');
      return;
    }

    roomRef.child('members').child(state.memberId).set({ name, online: true });
    roomRef.child('members').child(state.memberId).onDisconnect().update({ online: false });

    roomRef.child('chat').push({
      name : 'System',
      text : name + ' join ho gaya! 👋',
      ts   : Date.now()
    });

    // Host ko happy notification bhejo
    roomRef.child('notifications').push({
      type : 'join',
      name : name,
      ts   : Date.now()
    });

    listenToRoom();
    showRoom();
    toast('🎉 Room join ho gaya!');
  });
}

// ════════════════════════════════════════════
//   LEAVE ROOM
// ════════════════════════════════════════════
function leaveRoom() {
  if (roomRef && state.memberId) {
    roomRef.child('members').child(state.memberId).update({ online: false });
  }
  if (roomRef) roomRef.off();
  roomRef = null;

  if (player) { player.destroy(); player = null; }

  state = { name: '', roomCode: '', isHost: false, memberId: null };

  document.getElementById('lobby').style.display   = 'block';
  document.getElementById('lobby').style.opacity   = '1';
  document.getElementById('room').style.display    = 'none';
  document.getElementById('yt-player').innerHTML   = '';
  document.getElementById('placeholder').style.display = 'block';
  document.getElementById('controls').style.display    = 'none';
  document.getElementById('yt-url').value               = '';
  document.getElementById('chat-box').innerHTML         = '';
}

// ════════════════════════════════════════════
//   SHOW ROOM
// ════════════════════════════════════════════
function showRoom() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('room').style.display  = 'block';
  document.getElementById('room-title').textContent =
    state.isHost ? '🏠 Tumhara Room' : '🎬 Joined Room';
  document.getElementById('room-code-badge').textContent = state.roomCode;
}

// ════════════════════════════════════════════
//   LISTEN TO ROOM (Firebase real-time)
// ════════════════════════════════════════════
function listenToRoom() {

  // Members
  roomRef.child('members').on('value', (snap) => {
    const members = snap.val() || {};
    const el = document.getElementById('members-list');
    el.innerHTML = Object.values(members)
      .filter(m => m.online)
      .map(m => `<div class="member-chip">${m.name}</div>`)
      .join('');
    updateViewerCount(members);
  });

  // Play/Pause sync
  roomRef.child('playing').on('value', (snap) => {
    if (isSyncing || !player) return;
    const isPlaying = snap.val();
    if (isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
      player.playVideo();
      document.getElementById('btn-play').classList.add('active');
      document.getElementById('btn-pause').classList.remove('active');
    } else if (!isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
      player.pauseVideo();
      document.getElementById('btn-pause').classList.add('active');
      document.getElementById('btn-play').classList.remove('active');
    }
  });

  // Seek sync
  roomRef.child('currentTime').on('value', (snap) => {
    if (isSyncing || !player) return;
    const time = snap.val();
    if (time !== null && Math.abs(player.getCurrentTime() - time) > 2) {
      player.seekTo(time, true);
    }
  });

  // Video load
  roomRef.child('videoId').on('value', (snap) => {
    const videoId = snap.val();
    if (!videoId) return;
    if (!player) {
      initYouTubePlayer(videoId);
    } else {
      player.loadVideoById(videoId);
    }
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('controls').style.display    = 'flex';
    document.getElementById('sync-status').className     = 'sync-badge';
    document.getElementById('sync-status').textContent   = '✅ Synced!';
  });

  // Chat
  roomRef.child('chat').on('child_added', (snap) => {
    const msg     = snap.val();
    const chatBox = document.getElementById('chat-box');
    const div     = document.createElement('div');
    div.className = 'chat-msg' + (msg.name === 'System' ? ' system' : '');
    div.innerHTML = `<span class="name">${msg.name}:</span><span class="text">${msg.text}</span>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  // Join notifications
  roomRef.child('notifications').limitToLast(1).on('child_added', (snap) => {
    const data = snap.val();
    if (data.type === 'join' && Date.now() - data.ts < 3000) {
      showJoinNotification(data.name);
    }
  });

  // Reactions
  listenReactions();
}

// ════════════════════════════════════════════
//   YOUTUBE PLAYER
// ════════════════════════════════════════════
function initYouTubePlayer(videoId) {
  document.getElementById('yt-player').innerHTML = '';
  player = new YT.Player('yt-player', {
    videoId,
    playerVars : { autoplay: 0, controls: 1, rel: 0 },
    events     : { onStateChange: onPlayerStateChange }
  });
}

function onPlayerStateChange(event) {
  if (!state.isHost || isSyncing) return;
  isSyncing = true;
  if (event.data === YT.PlayerState.PLAYING) {
    roomRef.update({ playing: true, currentTime: player.getCurrentTime() });
  } else if (event.data === YT.PlayerState.PAUSED) {
    roomRef.update({ playing: false, currentTime: player.getCurrentTime() });
  }
  setTimeout(() => { isSyncing = false; }, 500);
}

// ════════════════════════════════════════════
//   LOAD VIDEO
// ════════════════════════════════════════════
function loadVideo() {
  if (!state.isHost) { toast('⚠️ Sirf host video load kar sakta hai!'); return; }
  const url     = document.getElementById('yt-url').value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) { toast('❌ Sahi YouTube link daalo!'); return; }

  roomRef.update({ videoId, playing: false, currentTime: 0 });
  roomRef.child('chat').push({ name: 'System', text: '🎬 Naya video load hua!', ts: Date.now() });
  toast('🎉 Video load! Dono saath dekhenge.');
}

// ════════════════════════════════════════════
//   CONTROLS
// ════════════════════════════════════════════
function syncPlay() {
  if (!state.isHost) { toast('⚠️ Sirf host control kar sakta hai!'); return; }
  if (!player) return;
  player.playVideo();
  roomRef.update({ playing: true, currentTime: player.getCurrentTime() });
  roomRef.child('chat').push({ name: state.name, text: '▶️ Play kiya', ts: Date.now() });
}

function syncPause() {
  if (!state.isHost) { toast('⚠️ Sirf host control kar sakta hai!'); return; }
  if (!player) return;
  player.pauseVideo();
  roomRef.update({ playing: false, currentTime: player.getCurrentTime() });
  roomRef.child('chat').push({ name: state.name, text: '⏸ Pause kiya', ts: Date.now() });
}

function syncSeek(seconds) {
  if (!state.isHost) { toast('⚠️ Sirf host control kar sakta hai!'); return; }
  if (!player) return;
  const newTime = player.getCurrentTime() + seconds;
  player.seekTo(newTime, true);
  roomRef.update({ currentTime: newTime });
}

// ════════════════════════════════════════════
//   CHAT
// ════════════════════════════════════════════
function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || !roomRef) return;
  roomRef.child('chat').push({ name: state.name, text, ts: Date.now() });
  input.value = '';
}

// ════════════════════════════════════════════
//   EMOJI REACTIONS
// ════════════════════════════════════════════
function sendReaction(emoji) {
  if (!roomRef) return;
  roomRef.child('reactions').push({ emoji, by: state.name, ts: Date.now() });
}

function listenReactions() {
  roomRef.child('reactions').limitToLast(1).on('child_added', (snap) => {
    const data = snap.val();
    if (Date.now() - data.ts < 5000) {
      showFloatingEmoji(data.emoji);
    }
  });
}

function showFloatingEmoji(emoji) {
  const container = document.getElementById('reaction-container');
  if (!container) return;
  const el        = document.createElement('div');
  el.className    = 'floating-emoji';
  el.textContent  = emoji;
  el.style.left   = (10 + Math.random() * 80) + '%';
  container.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ════════════════════════════════════════════
//   VIEWER COUNT
// ════════════════════════════════════════════
function updateViewerCount(members) {
  const online = Object.values(members).filter(m => m.online).length;
  const el     = document.getElementById('viewer-count-text');
  if (el) el.textContent = online === 1 ? '1 dekh raha hai' : online + ' dekh rahe hain';
}

// ════════════════════════════════════════════
//   JOIN NOTIFICATION + POPCORN
// ════════════════════════════════════════════
function showJoinNotification(name) {
  if (name === state.name) return;

  const notif     = document.createElement('div');
  notif.className = 'join-notification';
  notif.innerHTML = `
    <div class="join-notif-emoji">😄</div>
    <div class="join-notif-text">
      <div class="join-notif-name">${name}</div>
      <div style="color:#999;font-size:12px;">Room mein aa gaya! 🎉</div>
    </div>
  `;
  document.body.appendChild(notif);
  triggerPopcorn();

  setTimeout(() => {
    notif.style.transition = 'opacity 0.3s ease';
    notif.style.opacity    = '0';
    setTimeout(() => notif.remove(), 300);
  }, 4000);
}

function triggerPopcorn() {
  const emojis = ['🍿', '🍿', '🎬', '⭐', '✨'];
  for (let i = 0; i < 12; i++) {
    setTimeout(() => {
      const el        = document.createElement('div');
      el.className    = 'popcorn-particle';
      el.textContent  = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.left   = (20 + Math.random() * 60) + 'vw';
      el.style.top    = '80vh';
      el.style.setProperty('--tx', (Math.random() * 200 - 100) + 'px');
      el.style.setProperty('--ty', -(100 + Math.random() * 300) + 'px');
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }, i * 80);
  }
}
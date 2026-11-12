const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const tmi = require('tmi.js');
const cors = require('cors');
const axios = require('axios');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const liveSessions = {};
const pairingCodes = {};
const activeStreamers = {};

function getOrCreateRoom(roomId) {
  const cleanRoom = (roomId || 'default').toLowerCase().replace('@', '');
  if (!liveSessions[cleanRoom]) {
    liveSessions[cleanRoom] = {
      likes: {},
      gifts: {},
      totalLikes: 0,
      likeMilestoneStep: 500,
      scene: 'live',
      wheelOptions: ['10 Flexões', 'Escolher Música', 'Sem Mira 1 Ronda', 'Salve Especial', 'Desafio do Chat', 'Sorte Grande!'],
      socials: { tiktok: '', instagram: '', youtube: '', discord: '' },
      donationConfig: {
        title: 'Apoia a Live!',
        imageData: 'https://giphy.com',
        mbway: '',
        pix: '',
        paypal: '',
        message: 'Toca na imagem para copiar a chave e apoiar diretamente!'
      },
      goal: {
        title: 'Meta de Likes da Live',
        style: 'neon',
        current: 0,
        target: 5000
      }
    };
  }
  return liveSessions[cleanRoom];
}

app.get('/tts', async (req, res) => {
  try {
    const text = (req.query.text || 'Teste de voz HELL Live').toString().slice(0, 250);
    const voice = (req.query.voice || 'pt-PT-DuarteNeural').toString();
    const rate = (req.query.rate || '+0%').toString();
    const pitch = (req.query.pitch || '+0Hz').toString();

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate, pitch });

    res.setHeader('Content-Type', 'audio/mpeg');
    audioStream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Erro TTS', details: err.message });
  }
});

app.get('/search/gifs', async (req, res) => {
  try {
    const q = encodeURIComponent((req.query.q || 'gaming celebration').toString());
    const type = req.query.type === 'stickers' ? '&searchfilter=sticker' : '';
    const url = `https://tenor.com{q}&key=LIVDSRZULELA&limit=24${type}`;
    const response = await axios.get(url);
    const results = (response.data.results || []).map(item => ({
      id: item.id,
      title: item.content_description || 'GIF',
      url: item.media?.[0]?.tinygif?.url || item.media?.[0]?.gif?.url || ''
    })).filter(i => i.url);
    res.json({ results });
  } catch (err) {
    res.json({ results: [] });
  }
});

app.get('/community/live', (req, res) => {
  res.json({ streamers: Object.values(activeStreamers) });
});

app.get('/overlay/:room', (req, res) => {
  const room = req.params.room.toLowerCase().replace('@', '');
  const session = getOrCreateRoom(room);
  res.send(`<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<title>HELL Live Studio - ${room}</title>
<script src="/socket.io/socket.io.js"></script>
<style>
  body { margin: 0; overflow: hidden; background: transparent; font-family: 'Segoe UI', sans-serif; color: white; }
  #scene-screen {
    position: fixed; inset: 0; display: none; flex-direction: column; justify-content: center; align-items: center;
    background: radial-gradient(circle at center, #0E1D47 0%, #050B1E 100%); z-index: 50; text-align: center;
  }
  #scene-screen.active { display: flex; }
  #cam-frame {
    position: fixed; bottom: 24px; left: 24px; width: 320px; height: 190px;
    border: 3px solid #38BDF8; border-radius: 16px; box-shadow: 0 0 25px rgba(30, 120, 255, 0.6);
    display: none; pointer-events: none;
  }
  #cam-frame.active { display: block; }
  #alert-box {
    position: fixed; top: 10%; left: 50%; transform: translateX(-50%) scale(0.8);
    text-align: center; opacity: 0; transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    background: rgba(5, 11, 30, 0.9); border: 2px solid #38BDF8; border-radius: 20px;
    padding: 20px 32px; box-shadow: 0 0 35px rgba(30, 120, 255, 0.8); max-width: 480px; z-index: 40;
  }
  #alert-box.show { opacity: 1; transform: translateX(-50%) scale(1); }
  #alert-avatar { width: 72px; height: 72px; border-radius: 50%; border: 3px solid #38BDF8; object-fit: cover; display: none; margin: 0 auto 8px; }
  #alert-gif { max-width: 230px; max-height: 190px; border-radius: 12px; margin-bottom: 10px; }
  #alert-user { font-size: 26px; font-weight: 900; color: #38BDF8; }
  #alert-msg { font-size: 19px; font-weight: 600; margin-top: 6px; }
  #podium-box {
    position: fixed; top: 20px; right: 20px; background: rgba(5, 11, 30, 0.88);
    border: 1.5px solid #1E78FF; border-radius: 14px; padding: 12px 16px; width: 250px;
  }
  .podium-title { font-size: 13px; font-weight: 800; color: #38BDF8; letter-spacing: 1px; margin-bottom: 8px; }
  .podium-row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
  #like-counter {
    position: fixed; top: 20px; left: 20px; background: rgba(5, 11, 30, 0.88);
    border: 1.5px solid #F43F5E; border-radius: 14px; padding: 10px 18px; font-weight: 900; font-size: 18px; color: #FDA4AF;
  }
  #goal-bar-wrap {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    width: 460px; background: rgba(5, 11, 30, 0.9); border: 1.5px solid #1E78FF;
    border-radius: 14px; padding: 10px 16px;
  }
  #goal-progress { height: 14px; background: linear-gradient(90deg, #1E78FF, #38BDF8); border-radius: 8px; width: 0%; transition: width 0.4s; }
  #wheel-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0);
    background: rgba(5, 11, 30, 0.95); border: 3px solid #38BDF8; border-radius: 24px;
    padding: 28px 40px; text-align: center; transition: transform 0.35s; z-index: 45;
  }
  #wheel-modal.show { transform: translate(-50%, -50%) scale(1); }
  .watermark { position: fixed; bottom: 6px; right: 12px; font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 1px; }
</style>
</head>
<body>
  <div id="scene-screen"><h1 id="scene-title" style="font-size:52px; color:#38BDF8; margin:0;">A COMEÇAR EM BREVE</h1><p style="font-size:22px; color:#cbd5e1;">HELL Live · LIVE · PLAY · CONNECT</p></div>
  <div id="cam-frame"></div>
  <div id="like-counter">❤️ <span id="likes-val">${session.totalLikes}</span></div>
  <div id="alert-box">
    <img id="alert-avatar" src="" />
    <img id="alert-gif" src="" />
    <div id="alert-user"></div>
    <div id="alert-msg"></div>
  </div>
  <div id="wheel-modal">
    <div style="font-size:16px; color:#38BDF8; font-weight:bold;">🎡 ROLETA INTERATIVA</div>
    <div id="wheel-result" style="font-size:34px; font-weight:900; margin-top:12px; color:white;">A girar...</div>
  </div>
  <div id="podium-box">
    <div class="podium-title">🏆 PÓDIO DA LIVE</div>
    <div id="podium-list"><div class="podium-row"><span>A aguardar apoio...</span></div></div>
  </div>
  <div id="goal-bar-wrap">
    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:bold; margin-bottom:6px;">
      <span id="goal-title">${session.goal.title}</span>
      <span id="goal-numbers">${session.goal.current} / ${session.goal.target}</span>
    </div>
    <div style="background:rgba(255,255,255,0.1); border-radius:8px; overflow:hidden;">
      <div id="goal-progress"></div>
    </div>
  </div>
  <div class="watermark">HELL Live</div>
  <audio id="alert-audio"></audio>
  <script>
    const socket = io();
    socket.emit('join_room', '${room}');
    const box = document.getElementById('alert-box');
    const avatarEl = document.getElementById('alert-avatar');
    const gifEl = document.getElementById('alert-gif');
    const userEl = document.getElementById('alert-user');
    const msgEl = document.getElementById('alert-msg');
    const audioEl = document.getElementById('alert-audio');

    socket.on('scene_change', ({ scene }) => {
      const sc = document.getElementById('scene-screen');
      const title = document.getElementById('scene-title');
      const cam = document.getElementById('cam-frame');
      sc.classList.remove('active'); cam.classList.remove('active');
      if (scene === 'starting') { title.textContent = 'A LIVE VAI COMEÇAR...'; sc.classList.add('active'); }
      else if (scene === 'brb') { title.textContent = 'JÁ VOLTAMOS (PAUSA)'; sc.classList.add('active'); }
      else if (scene === 'ending') { title.textContent = 'OBRIGADO POR ASSISTIRES!'; sc.classList.add('active'); }
      else if (scene === 'cam_frame') { cam.classList.add('active'); }
    });

    socket.on('overlay_alert', (data) => {
      userEl.textContent = data.user || 'Apoiante';
      msgEl.textContent = data.message || '';
      if (data.avatarUrl) { avatarEl.src = data.avatarUrl; avatarEl.style.display = 'block'; } else { avatarEl.style.display = 'none'; }
      if (data.gifUrl) { gifEl.src = data.gifUrl; gifEl.style.display = 'inline-block'; } else { gifEl.style.display = 'none'; }
      box.classList.add('show');
      if (data.soundUrl) { audioEl.src = data.soundUrl; audioEl.play().catch(()=>{}); }
      setTimeout(() => box.classList.remove('show'), (data.duration || 5) * 1000);
    });

    socket.on('wheel_spin', ({ options }) => {
      const modal = document.getElementById('wheel-modal');
      const resEl = document.getElementById('wheel-result');
      const list = options && options.length ? options : ['Desafio Surpresa'];
      modal.classList.add('show');
      let ticks = 0;
      const iv = setInterval(() => {
        resEl.textContent = list[ticks % list.length];
        ticks++;
        if (ticks > 18) {
          clearInterval(iv);
          const winner = list[Math.floor(Math.random() * list.length)];
          resEl.textContent = '🎉 ' + winner;
          setTimeout(() => modal.classList.remove('show'), 4500);
        }
      }, 110);
    });

    socket.on('likes_total', (total) => { document.getElementById('likes-val').textContent = total; });

    socket.on('podium_update', (data) => {
      const list = document.getElementById('podium-list');
      const top = (data.topGifts && data.topGifts.length) ? data.topGifts : (data.topLikes || []);
      if (!top.length) return;
      const medals = ['🥇', '🥈', '🥉'];
      list.innerHTML = top.slice(0, 3).map((u, i) =>
        '<div class="podium-row"><span>' + medals[i] + ' ' + u.user + '</span><b>' + u.score + '</b></div>'
      ).join('');
    });

    socket.on('goal_update', (g) => {
      document.getElementById('goal-title').textContent = g.title;
      document.getElementById('goal-numbers').textContent = g.current + ' / ' + g.target;
      const pct = Math.min(100, Math.round((g.current / (g.target || 1)) * 100));
      document.getElementById('goal-progress').style.width = pct + '%';
    });
  </script>
</body>
</html>`);
});
app.get('/doar/:room', (req, res) => {
  const room = req.params.room.toLowerCase().replace('@', '');
  const session = getOrCreateRoom(room);
  const cfg = session.donationConfig;
  res.send(`<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cfg.title} - HELL Live</title>
<script src="/socket.io/socket.io.js"></script>
<style>
  body { background: #050B1E; color: white; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 16px; }
  .card { background: linear-gradient(145deg, #0E1D47, #08112B); border: 1.5px solid #1E78FF; border-radius: 20px; padding: 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 0 30px rgba(30,120,255,0.25); }
  .banner { width: 100%; max-height: 220px; object-fit: contain; border-radius: 14px; cursor: pointer; border: 2px solid #38BDF8; background: rgba(0,0,0,0.25); }
  .btn { display: block; width: 100%; padding: 14px; margin-top: 12px; border: none; border-radius: 12px; background: #1E78FF; color: white; font-weight: bold; font-size: 15px; cursor: pointer; }
  input { width: 100%; padding: 12px; margin-top: 12px; border-radius: 10px; border: 1px solid #1E429F; background: #050B1E; color: white; box-sizing: border-box; }
</style>
</head>
<body>
  <div class="card">
    <h2 style="margin-top:0; color:#38BDF8;">${cfg.title}</h2>
    <p style="font-size:14px; color:#cbd5e1;">${cfg.message}</p>
    <img class="banner" src="${cfg.imageData}" onclick="copyKey()" alt="Tocar para Doar" />
    <input id="donorName" placeholder="O teu nome na live" />
    <input id="donorMsg" placeholder="Mensagem de apoio (opcional)" />
    ${cfg.mbway ? `<button class="btn" onclick="copyText('${cfg.mbway}', 'MB Way')">📱 Copiar MB Way: ${cfg.mbway}</button>` : ''}
    ${cfg.pix ? `<button class="btn" onclick="copyText('${cfg.pix}', 'PIX')">💠 Copiar Chave PIX</button>` : ''}
    ${cfg.paypal ? `<button class="btn" onclick="window.open('${cfg.paypal}', '_blank')">💳 Doar via Link / PayPal</button>` : ''}
    <p id="feedback" style="color:#4ade80; font-size:13px; margin-top:14px;"></p>
    <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:16px;">HELL Live · LIVE · PLAY · CONNECT</div>
  </div>
  <script>
    const socket = io();
    function copyText(val, method) {
      navigator.clipboard.writeText(val);
      const user = document.getElementById('donorName').value || 'Apoiante';
      const msg = document.getElementById('donorMsg').value || ('Apoiou via ' + method + '!');
      document.getElementById('feedback').textContent = '✅ ' + method + ' copiado! Alerta enviado para a live!';
      socket.emit('trigger_donation', { room: '${room}', user, message: msg });
    }
    function copyKey() {
      const key = '${cfg.mbway || cfg.pix || ''}';
      if (key) copyText(key, '${cfg.mbway ? "MB Way" : "PIX"}');
    }
  </script>
</body>
</html>`);
});

app.get('/', (req, res) => res.send('HELL Live Engine v3.0 Online!'));
io.on('connection', (socket) => {
  let tiktokConn = null;
  let twitchClient = null;
  let activeRoom = 'default';

  socket.on('join_room', (room) => {
    activeRoom = (room || 'default').toLowerCase().replace('@', '');
    socket.join(activeRoom);
    const session = getOrCreateRoom(activeRoom);
    socket.emit('goal_update', session.goal);
    socket.emit('likes_total', session.totalLikes);
  });

  socket.on('create_pair_code', (room) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pairingCodes[code] = { hostSocketId: socket.id, room, expires: Date.now() + 60000 };
    socket.emit('pair_code_created', { code });
  });

  socket.on('request_pair', ({ code, deviceName }) => {
    const entry = pairingCodes[code];
    if (!entry || Date.now() > entry.expires) return socket.emit('pair_error', 'Código inválido ou expirado.');
    io.to(entry.hostSocketId).emit('pair_approval_needed', {
      remoteSocketId: socket.id,
      deviceName: deviceName || 'Stream Deck',
      code
    });
  });

  socket.on('approve_pair', ({ remoteSocketId, code }) => {
    const entry = pairingCodes[code];
    if (entry) {
      delete pairingCodes[code];
      io.to(remoteSocketId).emit('pair_approved', { room: entry.room });
    }
  });

  socket.on('remote_command', ({ room, command, payload }) => {
    const clean = (room || 'default').toLowerCase().replace('@', '');
    if (command === 'scene') io.to(clean).emit('scene_change', { scene: payload });
    else if (command === 'wheel') {
      const session = getOrCreateRoom(clean);
      io.to(clean).emit('wheel_spin', { options: payload || session.wheelOptions });
    } else {
      io.to(clean).emit('execute_remote_command', { command, payload });
    }
  });

  socket.on('update_donation_config', ({ room, config }) => {
    const session = getOrCreateRoom(room);
    session.donationConfig = { ...session.donationConfig, ...config };
  });

  socket.on('update_goal', ({ room, goal }) => {
    const session = getOrCreateRoom(room);
    session.goal = { ...session.goal, ...goal };
    io.to((room || 'default').toLowerCase().replace('@', '')).emit('goal_update', session.goal);
  });

  socket.on('trigger_donation', ({ room, user, message }) => {
    const clean = (room || 'default').toLowerCase().replace('@', '');
    const session = getOrCreateRoom(clean);
    io.to(clean).emit('live_event', { platform: 'donation', type: 'gift', user, message });
    io.to(clean).emit('overlay_alert', {
      user,
      message,
      gifUrl: session.donationConfig.imageData,
      duration: 6
    });
  });

  socket.on('trigger_overlay_alert', ({ room, alertData }) => {
    const clean = (room || 'default').toLowerCase().replace('@', '');
    io.to(clean).emit('overlay_alert', alertData);
  });

  socket.on('connect_platform', async ({ platform, username }) => {
    const cleanUser = (username || '').replace('@', '').trim();
    if (!cleanUser) return;
    activeRoom = cleanUser.toLowerCase();
    socket.join(activeRoom);
    const session = getOrCreateRoom(activeRoom);

    if (platform === 'tiktok') {
      if (tiktokConn) { try { tiktokConn.disconnect(); } catch (e) {} }
      tiktokConn = new WebcastPushConnection(cleanUser);
      try {
        await tiktokConn.connect();
        activeStreamers[activeRoom] = { user: cleanUser, platform: 'TikTok', url: `https://tiktok.com{cleanUser}/live` };
        socket.emit('status', { platform: 'tiktok', connected: true, user: cleanUser });

        tiktokConn.on('chat', (data) => {
          io.to(activeRoom).emit('live_event', {
            platform: 'tiktok', type: 'chat', user: data.nickname || data.uniqueId, avatar: data.profilePictureUrl, message: data.comment
          });
        });

        tiktokConn.on('like', (data) => {
          const u = data.nickname || data.uniqueId;
          const count = data.likeCount || 1;
          const prev = session.likes[u] || 0;
          const now = prev + count;
          session.likes[u] = now;
          session.totalLikes += count;
          session.goal.current += count;

          const step = session.likeMilestoneStep || 500;
          if (Math.floor(now / step) > Math.floor(prev / step)) {
            io.to(activeRoom).emit('overlay_alert', {
              user: `${u} atingiu ${Math.floor(now / step) * step} Likes!`,
              message: 'Obrigado pelo apoio incrível!',
              avatarUrl: data.profilePictureUrl || '',
              gifUrl: 'https://giphy.com',
              duration: 5
            });
          }

          const topLikes = Object.entries(session.likes).map(([user, score]) => ({ user, score })).sort((a, b) => b.score - a.score);
          io.to(activeRoom).emit('podium_update', { topLikes });
          io.to(activeRoom).emit('likes_total', session.totalLikes);
          io.to(activeRoom).emit('goal_update', session.goal);
        });

        tiktokConn.on('gift', (data) => {
          if (data.giftType === 1 && !data.repeatEnd) return;
          const u = data.nickname || data.uniqueId;
          const coins = (data.diamondCount || 1) * (data.repeatCount || 1);
          session.gifts[u] = (session.gifts[u] || 0) + coins;
          const topGifts = Object.entries(session.gifts).map(([user, score]) => ({ user, score })).sort((a, b) => b.score - a.score);
          io.to(activeRoom).emit('podium_update', { topGifts });
          io.to(activeRoom).emit('live_event', {
            platform: 'tiktok', type: 'gift', user: u, avatar: data.profilePictureUrl,
            giftName: data.giftName,
            message: `enviou ${data.repeatCount}x ${data.giftName}!`
          });
        });
      } catch (err) {
        socket.emit('status', { platform: 'tiktok', connected: false, error: 'Live offline ou utilizador inválido.' });
      }
    } else if (platform === 'twitch') {
      if (twitchClient) { try { twitchClient.disconnect(); } catch (e) {} }
      twitchClient = new tmi.Client({ channels: [cleanUser] });
      twitchClient.connect().then(() => {
        activeStreamers[activeRoom] = { user: cleanUser, platform: 'Twitch', url: `https://twitch.tv{cleanUser}` };
        socket.emit('status', { platform: 'twitch', connected: true, user: cleanUser });
      }).catch(() => socket.emit('status', { platform: 'twitch', connected: false, error: 'Erro ao ligar à Twitch.' }));
      twitchClient.on('message', (ch, tags, msg, self) => {
        if (!self) io.to(activeRoom).emit('live_event', { platform: 'twitch', type: 'chat', user: tags['display-name'] || tags.username, message: msg });
      });
    } else {
      activeStreamers[activeRoom] = {
        user: cleanUser,
        platform: platform === 'youtube' ? 'YouTube' : 'Kick',
        url: platform === 'youtube' ? `https://youtube.com{cleanUser}/live` : `https://kick.com{cleanUser}`
      };
      socket.emit('status', { platform, connected: true, user: cleanUser });
    }
  });

  socket.on('disconnect', () => {
    delete activeStreamers[activeRoom];
    if (tiktokConn) { try { tiktokConn.disconnect(); } catch (e) {} }
    if (twitchClient) { try { twitchClient.disconnect(); } catch (e) {} }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HELL Live Engine v3.0 a rodar na porta ${PORT}`));

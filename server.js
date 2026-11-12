const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const tmi = require('tmi.js');
const cors = require('cors');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Memória da sessão ao vivo (Pódio, Configurações de Doação e Emparelhamento)
const liveSessions = {};
const pairingCodes = {};

function getOrCreateRoom(roomId) {
  const cleanRoom = (roomId || 'default').toLowerCase().replace('@', '');
  if (!liveSessions[cleanRoom]) {
    liveSessions[cleanRoom] = {
      likes: {},
      gifts: {},
      donationConfig: {
        title: 'Apoia a Live!',
        imageUrl: 'https://giphy.com',
        mbway: '',
        pix: '',
        paypal: '',
        message: 'Toca na imagem para copiar a chave e apoiar diretamente!'
      },
      goal: {
        title: 'Meta de Likes da Live',
        current: 0,
        target: 5000
      }
    };
  }
  return liveSessions[cleanRoom];
}

// Endpoint de Voz Neural Real (Masculina / Feminina em PT-PT, PT-BR, EN, ES, FR)
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
    res.status(500).json({ error: 'Erro ao gerar áudio neural', details: err.message });
  }
});

// Página de Overlay Transparente para OBS Studio / TikTok Live Studio
app.get('/overlay/:room', (req, res) => {
  const room = req.params.room.toLowerCase().replace('@', '');
  res.send(`<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<title>HELL Live Overlay - ${room}</title>
<script src="/socket.io/socket.io.js"></script>
<style>
  body { margin: 0; overflow: hidden; background: transparent; font-family: 'Segoe UI', sans-serif; color: white; }
  #alert-box {
    position: fixed; top: 12%; left: 50%; transform: translateX(-50%) scale(0.8);
    text-align: center; opacity: 0; transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    background: rgba(5, 11, 30, 0.88); border: 2px solid #38BDF8; border-radius: 20px;
    padding: 20px 32px; box-shadow: 0 0 30px rgba(30, 120, 255, 0.7); max-width: 480px;
  }
  #alert-box.show { opacity: 1; transform: translateX(-50%) scale(1); }
  #alert-gif { max-width: 240px; max-height: 200px; border-radius: 12px; margin-bottom: 12px; }
  #alert-user { font-size: 28px; font-weight: 900; color: #38BDF8; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
  #alert-msg { font-size: 20px; font-weight: 600; margin-top: 6px; }
  #podium-box {
    position: fixed; top: 20px; right: 20px; background: rgba(5, 11, 30, 0.85);
    border: 1.5px solid #1E78FF; border-radius: 14px; padding: 12px 16px; width: 250px;
  }
  .podium-title { font-size: 13px; font-weight: 800; color: #38BDF8; letter-spacing: 1px; margin-bottom: 8px; }
  .podium-row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
  #goal-bar-wrap {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    width: 460px; background: rgba(5, 11, 30, 0.88); border: 1.5px solid #1E78FF;
    border-radius: 14px; padding: 10px 16px;
  }
  #goal-progress { height: 14px; background: linear-gradient(90deg, #1E78FF, #38BDF8); border-radius: 8px; width: 0%; transition: width 0.4s; }
  .watermark { position: fixed; bottom: 4px; right: 10px; font-size: 10px; color: rgba(255,255,255,0.45); letter-spacing: 1px; }
</style>
</head>
<body>
  <div id="alert-box">
    <img id="alert-gif" src="" alt="" />
    <div id="alert-user"></div>
    <div id="alert-msg"></div>
  </div>
  <div id="podium-box">
    <div class="podium-title">🏆 PÓDIO DA LIVE</div>
    <div id="podium-list"><div class="podium-row"><span>A aguardar apoio...</span></div></div>
  </div>
  <div id="goal-bar-wrap">
    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:bold; margin-bottom:6px;">
      <span id="goal-title">Meta da Live</span>
      <span id="goal-numbers">0 / 5000</span>
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
    const gifEl = document.getElementById('alert-gif');
    const userEl = document.getElementById('alert-user');
    const msgEl = document.getElementById('alert-msg');
    const audioEl = document.getElementById('alert-audio');

    socket.on('overlay_alert', (data) => {
      userEl.textContent = data.user || 'Apoiante';
      msgEl.textContent = data.message || '';
      if (data.gifUrl) { gifEl.src = data.gifUrl; gifEl.style.display = 'inline-block'; }
      else { gifEl.style.display = 'none'; }
      box.classList.add('show');
      if (data.soundUrl) { audioEl.src = data.soundUrl; audioEl.play().catch(()=>{}); }
      setTimeout(() => box.classList.remove('show'), (data.duration || 5) * 1000);
    });

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
// Página Pública de Doação Direta (MB Way / PIX / PayPal) com Imagem Personalizada
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
  .banner { width: 100%; max-height: 210px; object-fit: cover; border-radius: 14px; cursor: pointer; border: 2px solid #38BDF8; transition: transform 0.2s; }
  .banner:active { transform: scale(0.97); }
  .btn { display: block; width: 100%; padding: 14px; margin-top: 12px; border: none; border-radius: 12px; background: #1E78FF; color: white; font-weight: bold; font-size: 15px; cursor: pointer; }
  input { width: 100%; padding: 12px; margin-top: 12px; border-radius: 10px; border: 1px solid #1E429F; background: #050B1E; color: white; box-sizing: border-box; }
</style>
</head>
<body>
  <div class="card">
    <h2 style="margin-top:0; color:#38BDF8;">${cfg.title}</h2>
    <p style="font-size:14px; color:#cbd5e1;">${cfg.message}</p>
    <img class="banner" src="${cfg.imageUrl}" onclick="copyKey()" alt="Tocar para Doar" />
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

app.get('/', (req, res) => res.send('HELL Live Engine v2.0 Online!'));

io.on('connection', (socket) => {
  let tiktokConn = null;
  let twitchClient = null;
  let activeRoom = 'default';

  socket.on('join_room', (room) => {
    activeRoom = (room || 'default').toLowerCase().replace('@', '');
    socket.join(activeRoom);
    const session = getOrCreateRoom(activeRoom);
    socket.emit('goal_update', session.goal);
  });

  // Gerar Código / QR de Emparelhamento (Válido 60s)
  socket.on('create_pair_code', (room) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pairingCodes[code] = { hostSocketId: socket.id, room, expires: Date.now() + 60000 };
    socket.emit('pair_code_created', { code });
  });

  socket.on('request_pair', ({ code, deviceName }) => {
    const entry = pairingCodes[code];
    if (!entry || Date.now() > entry.expires) {
      return socket.emit('pair_error', 'Código inválido ou expirado.');
    }
    io.to(entry.hostSocketId).emit('pair_approval_needed', {
      remoteSocketId: socket.id,
      deviceName: deviceName || 'Comando Remoto',
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
    io.to(clean).emit('execute_remote_command', { command, payload });
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
    io.to(clean).emit('live_event', { platform: 'donation', type: 'gift', user, message });
    io.to(clean).emit('overlay_alert', {
      user,
      message,
      gifUrl: 'https://giphy.com',
      duration: 6
    });
  });

  socket.on('trigger_overlay_alert', ({ room, alertData }) => {
    const clean = (room || 'default').toLowerCase().replace('@', '');
    io.to(clean).emit('overlay_alert', alertData);
  });

  socket.on('connect_tiktok', async (username) => {
    if (tiktokConn) { try { tiktokConn.disconnect(); } catch (e) {} }
    const cleanUser = username.replace('@', '').trim();
    activeRoom = cleanUser.toLowerCase();
    socket.join(activeRoom);
    const session = getOrCreateRoom(activeRoom);

    tiktokConn = new WebcastPushConnection(cleanUser);
    try {
      await tiktokConn.connect();
      socket.emit('status', { platform: 'tiktok', connected: true, user: cleanUser });

      tiktokConn.on('chat', (data) => {
        io.to(activeRoom).emit('live_event', {
          platform: 'tiktok', type: 'chat', user: data.nickname || data.uniqueId, message: data.comment
        });
      });

      tiktokConn.on('like', (data) => {
        const u = data.nickname || data.uniqueId;
        const count = data.likeCount || 1;
        session.likes[u] = (session.likes[u] || 0) + count;
        session.goal.current += count;
        const topLikes = Object.entries(session.likes).map(([user, score]) => ({ user, score })).sort((a, b) => b.score - a.score);
        io.to(activeRoom).emit('podium_update', { topLikes });
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
          platform: 'tiktok', type: 'gift', user: u,
          giftName: data.giftName,
          message: `enviou ${data.repeatCount}x ${data.giftName}!`
        });
      });
    } catch (err) {
      socket.emit('status', { platform: 'tiktok', connected: false, error: 'Live offline ou utilizador inválido.' });
    }
  });

  socket.on('disconnect', () => {
    if (tiktokConn) { try { tiktokConn.disconnect(); } catch (e) {} }
    if (twitchClient) { try { twitchClient.disconnect(); } catch (e) {} }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HELL Live Engine v2.0 a rodar na porta ${PORT}`));

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const tmi = require('tmi.js');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.get('/', (req, res) => {
  res.send('Motor de Lives Online e Funcionando!');
});

io.on('connection', (socket) => {
  console.log('App conectado:', socket.id);
  let tiktokConnection = null;
  let twitchClient = null;

  // Conectar ao TikTok
  socket.on('connect_tiktok', (username) => {
    if (tiktokConnection) tiktokConnection.disconnect();
    const cleanUser = username.replace('@', '').trim();
    tiktokConnection = new WebcastPushConnection(cleanUser);

    tiktokConnection.connect().then(() => {
      socket.emit('status', { platform: 'tiktok', connected: true, user: cleanUser });
    }).catch(err => {
      socket.emit('status', { platform: 'tiktok', connected: false, error: 'Live offline ou usuário inválido' });
    });

    tiktokConnection.on('chat', (data) => {
      io.to(socket.id).emit('live_event', {
        platform: 'tiktok',
        type: 'chat',
        user: data.nickname || data.uniqueId,
        message: data.comment,
        avatar: data.profilePictureUrl
      });
    });

    tiktokConnection.on('gift', (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      io.to(socket.id).emit('live_event', {
        platform: 'tiktok',
        type: 'gift',
        user: data.nickname || data.uniqueId,
        message: `Enviou ${data.repeatCount}x ${data.giftName}`,
        giftName: data.giftName,
        count: data.repeatCount
      });
    });
  });

  // Conectar à Twitch
  socket.on('connect_twitch', (channel) => {
    if (twitchClient) twitchClient.disconnect();
    twitchClient = new tmi.Client({ channels: [channel.trim()] });
    
    twitchClient.connect().then(() => {
      socket.emit('status', { platform: 'twitch', connected: true, user: channel });
    }).catch(() => {
      socket.emit('status', { platform: 'twitch', connected: false, error: 'Erro ao conectar na Twitch' });
    });

    twitchClient.on('message', (chan, tags, message, self) => {
      io.to(socket.id).emit('live_event', {
        platform: 'twitch',
        type: 'chat',
        user: tags['display-name'] || tags.username,
        message: message,
        avatar: ''
      });
    });
  });

  socket.on('disconnect', () => {
    if (tiktokConnection) tiktokConnection.disconnect();
    if (twitchClient) twitchClient.disconnect();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

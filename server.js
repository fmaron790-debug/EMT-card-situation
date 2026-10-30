const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

// 🆕 管理室（CMS）の最新設定をサーバー側で一元保持（どの端末から入っても同じ内容に同期）
let globalAccessState = { game1: true, game2: true, game3: true, game4: false };
let globalCardDB = null;

// プレイヤーごとに割り当てるカラーパレット（視認性の高い10色）
const PLAYER_COLORS = [
  '#38bdf8', // スカイブルー
  '#f43f5e', // ローズレッド
  '#10b981', // エメラルドグリーン
  '#f59e0b', // アンバーイエロー
  '#a855f7', // パープル
  '#ec4899', // ピンク
  '#84cc16', // ライムグリーン
  '#f97316', // オレンジ
  '#06b6d4', // シアン
  '#6366f1'  // インディゴ
];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 🆕 接続した端末へ現在の管理室設定・カードDBを即座に同期
  socket.emit('update_access', globalAccessState);
  if (globalCardDB) {
    socket.emit('update_cards', globalCardDB);
  }

  // 🆕 管理室を開いた際などの最新状態リクエストに応答
  socket.on('request_admin_state', () => {
    socket.emit('update_access', globalAccessState);
    if (globalCardDB) {
      socket.emit('update_cards', globalCardDB);
    }
  });

  socket.on('join_room', (data) => {
    const { roomCode, playerName, config } = data;
    socket.join(roomCode);

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        discardPile: [],
        turnIdx: 0,
        hasDrawnThisTurn: false,
        config: config || {}
      };
    }

    let player = rooms[roomCode].players.find(p => p.id === socket.id);
    if (!player) {
      const usedColors = rooms[roomCode].players.map(p => p.color);
      const availableColors = PLAYER_COLORS.filter(c => !usedColors.includes(c));
      const pool = availableColors.length > 0 ? availableColors : PLAYER_COLORS;
      const randomColor = pool[Math.floor(Math.random() * pool.length)];

      player = {
        id: socket.id,
        name: playerName || '救急隊員',
        isAI: false,
        hand: [],
        isCleared: false,
        isReady: false,
        rank: 0,
        team: (rooms[roomCode].players.length % 3) + 1,
        color: randomColor
      };
      rooms[roomCode].players.push(player);
    } else if (playerName) {
      player.name = playerName;
    }

    io.to(roomCode).emit('update_room', {
      players: rooms[roomCode].players,
      discardPile: rooms[roomCode].discardPile,
      config: rooms[roomCode].config
    });
  });

  // ゲーム内アクションの同期
  socket.on('game_action', (data) => {
    const { roomCode, type, players, discardPile, turnIdx, hasDrawnThisTurn } = data;
    const room = rooms[roomCode];
    
    if (room) {
      if (type === 'draw') {
        if (room.hasDrawnThisTurn) return;
        room.hasDrawnThisTurn = true;
      } else if (type === 'next_turn' || type === 'ready' || type === 'start') {
        room.hasDrawnThisTurn = false;
      } else if (hasDrawnThisTurn !== undefined) {
        room.hasDrawnThisTurn = hasDrawnThisTurn;
      }

      if (players) room.players = players;
      if (discardPile) room.discardPile = discardPile;
      if (turnIdx !== undefined) room.turnIdx = turnIdx;
    }

    io.to(roomCode).emit('game_action', data);
  });

  // 🆕 管理室での出動権限変更をサーバーに保存し、全端末へ即時配信
  socket.on('admin_update_access', (accessData) => {
    if (accessData && typeof accessData === 'object') {
      globalAccessState = { ...globalAccessState, ...accessData };
      io.emit('update_access', globalAccessState);
    }
  });

  // 🆕 管理室でのカードDB変更をサーバーに保存し、全端末へ即時配信
  socket.on('admin_update_cards', (dbData) => {
    if (Array.isArray(dbData)) {
      globalCardDB = dbData;
      io.emit('update_cards', globalCardDB);
    }
  });

  // 🆕 チャットを全プレイヤー公開に変更（誰が打っても全員が見られる）
  socket.on('send_chat', (data) => {
    const { name, message } = data;
    io.emit('receive_chat', { name, message });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(roomCode).emit('update_room', {
          players: room.players,
          discardPile: room.discardPile,
          config: room.config
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
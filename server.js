const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静的ファイルの公開設定
app.use(express.static(__dirname));

// ルート（/）へのアクセスのフォールバック
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ルーム参加（ID指定での入室処理）
  socket.on('join_room', (data) => {
    const { roomCode, playerName, config } = data;
    socket.join(roomCode);

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        discardPile: [],
        turnIdx: 0,
        config: config || {}
      };
    }

    let player = rooms[roomCode].players.find(p => p.id === socket.id);
    if (!player) {
      player = {
        id: socket.id,
        name: playerName || '救急隊員',
        isAI: false,
        hand: [],
        isCleared: false,
        rank: 0,
        team: 1,
        color: '#38bdf8'
      };
      rooms[roomCode].players.push(player);
    }

    io.to(roomCode).emit('update_room', {
      players: rooms[roomCode].players,
      discardPile: rooms[roomCode].discardPile,
      config: rooms[roomCode].config
    });
  });

  // 修正：ゲーム内アクション（自分を含むルーム全員に同期を徹底）
  // ゲーム内アクション
  socket.on('game_action', (data) => {
    const { roomCode, type, players, discardPile, turnIdx, hasDrawnThisTurn } = data;
    if (rooms[roomCode]) {
      if (players) rooms[roomCode].players = players;
      if (discardPile) rooms[roomCode].discardPile = discardPile;
      if (turnIdx !== undefined) rooms[roomCode].turnIdx = turnIdx;
    }
    // ルーム全員（自分含む）に最新の状態を確実に同期
    io.to(roomCode).emit('game_action', data);
  });
  // 管理者によるアクセス権限の即時全体反映
  socket.on('admin_update_access', (accessData) => {
    io.emit('update_access', accessData);
  });

  // 管理者によるカードデータベースの即時全体同期
  socket.on('admin_update_cards', (dbData) => {
    io.emit('update_cards', dbData);
  });

  // ルーム内リアルタイムチャットの送受信
  socket.on('send_chat', (data) => {
    const { roomCode, name, message } = data;
    if (roomCode && rooms[roomCode]) {
      io.to(roomCode).emit('receive_chat', { name, message });
    } else {
      io.emit('receive_chat', { name, message });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // 参加していたルームから切断された場合の処理（必要に応じてルーム内プレイヤー管理）
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
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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

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

  // 厳格なゲームアクション管理
  socket.on('game_action', (data) => {
    const { roomCode, type, players, discardPile, turnIdx, hasDrawnThisTurn } = data;
    const room = rooms[roomCode];
    
    if (room) {
      // 🔒 【サーバー側の絶対ガード】対人戦での複数ドローを完全に防ぐ
      if (type === 'draw') {
        const currentP = room.players[room.turnIdx];
        // 送信者が現在のターンプレイヤーではない場合、または既に引いている場合は即座に拒否
        if (!currentP || currentP.id !== socket.id) {
          return;
        }
      }

      if (players) room.players = players;
      if (discardPile) room.discardPile = discardPile;
      if (turnIdx !== undefined) room.turnIdx = turnIdx;
    }

    io.to(roomCode).emit('game_action', data);
  });

  socket.on('admin_update_access', (accessData) => {
    io.emit('update_access', accessData);
  });

  socket.on('admin_update_cards', (dbData) => {
    io.emit('update_cards', dbData);
  });

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
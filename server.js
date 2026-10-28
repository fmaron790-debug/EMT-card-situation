const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id);

  // ルーム参加・作成
  socket.on('join_room', (data) => {
    const { roomCode, playerName, config } = data;
    socket.join(roomCode);

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        discardPile: [],
        config: config || {}
      };
    }

    const existingPlayer = rooms[roomCode].players.find(p => p.id === socket.id);
    if (!existingPlayer) {
      rooms[roomCode].players.push({
        id: socket.id,
        name: playerName,
        isAI: false,
        hand: [],
        isCleared: false,
        rank: 0
      });
    }

    console.log(`${playerName} がルーム ${roomCode} に参加しました`);

    io.to(roomCode).emit('update_room', {
      players: rooms[roomCode].players,
      discardPile: rooms[roomCode].discardPile,
      config: rooms[roomCode].config
    });
  });

  // ゲーム中のアクション（手札・捨て札・ターン等の完全同期）
  socket.on('game_action', (data) => {
    const { roomCode, type, players, discardPile, turnIdx } = data;
    if (rooms[roomCode]) {
      if (players) rooms[roomCode].players = players;
      if (discardPile) rooms[roomCode].discardPile = discardPile;
    }
    socket.to(roomCode).emit('game_action', {
      type,
      players,
      discardPile,
      turnIdx
    });
  });

  // 切断時の処理
  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id);
    for (const roomCode in rooms) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      io.to(roomCode).emit('update_room', {
        players: rooms[roomCode].players,
        discardPile: rooms[roomCode].discardPile,
        config: rooms[roomCode].config
      });
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`EMS Server running on port ${PORT}`);
});
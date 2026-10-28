const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__public_dir_or_current_dir_if_needed)); // 静的ファイルの配信設定

io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id);

  // ルーム参加などの既存処理...
  socket.on('join_room', (data) => {
    socket.join(data.roomCode);
    // ルーム内の同期処理など
  });

  socket.on('game_action', (data) => {
    io.to(data.roomCode).emit('game_action', data);
  });

  // 👇 【追加・確認必須】管理者区域からのリアルタイム同期イベントの受け渡し
  socket.on('admin_sync_db', (newDB) => {
    // 自分以外の全クライアントに最新DBをブロードキャスト
    socket.broadcast.emit('sync_db', newDB);
  });

  socket.on('admin_sync_access', (newAccess) => {
    // 自分以外の全クライアントに出動権限をブロードキャスト
    socket.broadcast.emit('sync_access', newAccess);
  });

  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
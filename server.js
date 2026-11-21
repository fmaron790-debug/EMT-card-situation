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
const socketRoomMap = {}; // どのソケットがどのルームにいるかを記録するマップ

// 🎴 GAME 05（救急かるた）を含めた全5ゲームのアクセス権初期値
let globalAccessState = { game1: true, game2: true, game3: true, game4: true, game5: true, showResearchId: true };
let globalCardDB = null;
let globalAnnouncements = [];
const fs = require('fs');
const RESEARCH_LOG_FILE = path.join(__dirname, 'research_logs.json');
let globalResearchLogs = []; // 研究用個人プレイログ蓄積
try {
  if (fs.existsSync(RESEARCH_LOG_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(RESEARCH_LOG_FILE, 'utf8'));
    if (Array.isArray(loaded)) globalResearchLogs = loaded;
  }
} catch (e) {}

function saveResearchLogsToFile() {
  try { fs.writeFileSync(RESEARCH_LOG_FILE, JSON.stringify(globalResearchLogs)); } catch (e) {}
}


const PLAYER_COLORS = [
  '#38bdf8', '#f43f5e', '#10b981', '#f59e0b', '#a855f7',
  '#ec4899', '#84cc16', '#f97316', '#06b6d4', '#6366f1'
];

function broadcastActiveUsers() {
  io.emit('update_active_users', io.engine.clientsCount);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  broadcastActiveUsers();

  socket.emit('update_access', globalAccessState);
  if (globalCardDB) socket.emit('update_cards', globalCardDB);
  socket.emit('init_announcements', globalAnnouncements);

// クライアントからの研究用プレイログ記録（JST固定・重複防止・ファイル保存）
  const appendResearchLog = (entry) => {
    if (!entry || !entry.researchId) return false;
    const now = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const ts = isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString();
    const rId = String(entry.researchId);
    const ev = String(entry.eventType || '');
    const exists = globalResearchLogs.some(l => l.timestamp === ts && l.researchId === rId && l.eventType === ev);
    if (exists) return false;

    globalResearchLogs.push({
      timestamp: ts,
      dateStr: now.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      timeStr: now.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      researchId: rId,
      playerName: String(entry.playerName || ''),
      mode: String(entry.mode || ''),
      eventType: ev,
      isSolo: !!entry.isSolo,
      rank: entry.rank || '',
      score: entry.score !== undefined ? entry.score : ''
    });
    if (globalResearchLogs.length > 20000) globalResearchLogs.shift();
    return true;
  };

  socket.on('record_research_log', (entry) => {
    if (appendResearchLog(entry)) saveResearchLogsToFile();
  });

  // サーバー再起動後の自動復元用：端末ローカルの過去ログを一括同期
  socket.on('sync_local_research_logs', (entries) => {
    if (!Array.isArray(entries)) return;
    let added = false;
    entries.forEach(e => { if (appendResearchLog(e)) added = true; });
    if (added) saveResearchLogsToFile();
  });

socket.on('request_admin_state', () => {
    socket.emit('update_access', globalAccessState);
    if (globalCardDB) socket.emit('update_cards', globalCardDB);
    socket.emit('update_active_users', io.engine.clientsCount);
    socket.emit('init_announcements', globalAnnouncements);
    socket.emit('receive_research_logs', globalResearchLogs);
  });

  // CMSからの研究ログ一括取得リクエスト
  socket.on('request_research_logs', () => {
    socket.emit('receive_research_logs', globalResearchLogs);
  });

  socket.on('join_room', (data) => {
    const { roomCode, playerName, config } = data;
    socket.join(roomCode);
    socketRoomMap[socket.id] = roomCode;

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        discardPile: [],
        turnIdx: 0,
        hasDrawnThisTurn: false,
        config: config || {},
        karutaState: null // 🎴 かるたの状態管理用
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
        color: randomColor,
        totalInternal: 0,
        isStayed: false,
        isBusted: false,
        karutaScore: 0 // 🎴 かるた獲得枚数
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

  socket.on('game_action', (data) => {
    const { roomCode, type, players, discardPile, turnIdx, hasDrawnThisTurn, karutaState } = data;
    const room = rooms[roomCode];
    
    if (room) {
      if (type === 'karuta_touch') {
        if (room.karutaRoundLocked) return;
        room.karutaRoundLocked = true;
      } else if (type === 'karuta_next' || type === 'start') {
        room.karutaRoundLocked = false;
      }

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
      if (karutaState) room.karutaState = karutaState; // 🎴 かるたの状態をサーバー側で保持・更新
    }

    io.to(roomCode).emit('game_action', data);
  });

  socket.on('admin_update_access', (accessData) => {
    if (accessData && typeof accessData === 'object') {
      globalAccessState = { ...globalAccessState, ...accessData };
      io.emit('update_access', globalAccessState);
    }
  });

  socket.on('admin_update_cards', (dbData) => {
    if (Array.isArray(dbData)) {
      globalCardDB = dbData;
      io.emit('update_cards', globalCardDB);
    }
  });

  socket.on('admin_send_announcement', (data) => {
    const msg = (data && data.message ? String(data.message).trim() : '');
    if (!msg) return;
    const item = {
      id: Date.now(),
      message: msg,
      time: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    };
    globalAnnouncements.push(item);
    if (globalAnnouncements.length > 50) globalAnnouncements.shift();
    io.emit('receive_announcement', item);
  });

  socket.on('send_chat', (data) => {
    const { name, message } = data;
    io.emit('receive_chat', { name, message });
  });

  // 退出処理を確実に行う
  socket.on('leave_room', (data) => {
    const roomCode = data?.roomCode || socketRoomMap[socket.id];
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      socket.leave(roomCode);
      delete socketRoomMap[socket.id];

      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('update_room', {
          players: rooms[roomCode].players,
          discardPile: rooms[roomCode].discardPile,
          config: rooms[roomCode].config
        });
      }
    }
  });

  // 切断時も同様に紐づいたルームから即座に削除
  socket.on('disconnect', () => {
    console.log(`ユーザーが切断しました: ${socket.id}`);
    broadcastActiveUsers();

    const roomCode = socketRoomMap[socket.id];
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      delete socketRoomMap[socket.id];

      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('update_room', {
          players: rooms[roomCode].players,
          discardPile: rooms[roomCode].discardPile,
          config: rooms[roomCode].config
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
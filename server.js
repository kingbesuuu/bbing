
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Game state
let players = {};
let lockedSeeds = new Set();
let calledNumbers = new Set();
let callPool = [];
let callInterval = null;
let countdownTimer = null;
let countdownTime = 60;
let gameStarted = false;
let winnerInfo = null;

function broadcastPlayers() {
  io.emit('players', Object.values(players));
}

function startCountdownIfNeeded() {
  if (Object.keys(players).length >= 2 && !gameStarted && !countdownTimer) {
    countdownTime = 60;
    io.emit('countdown', countdownTime);

    countdownTimer = setInterval(() => {
      countdownTime--;
      io.emit('countdown', countdownTime);
      if (countdownTime <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        startGame();
      }
    }, 1000);
  }
}

function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  calledNumbers.clear();
  callPool = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  io.emit('gameStarted');

  callInterval = setInterval(() => {
    if (callPool.length === 0) return;
    const number = callPool.shift();
    calledNumbers.add(number);
    io.emit('numberCalled', number);
  }, 10000); // every 10s
}

function resetGame() {
  clearInterval(callInterval);
  clearInterval(countdownTimer);
  callInterval = null;
  countdownTimer = null;

  players = {};
  lockedSeeds = new Set();
  calledNumbers = new Set();
  callPool = [];
  gameStarted = false;
  winnerInfo = null;

  io.emit('reset');
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', ({ username, seed }) => {
    if (gameStarted) {
      socket.emit('blocked', 'Game already started');
      return;
    }
    if (lockedSeeds.has(seed)) {
      socket.emit('blocked', 'Card already taken');
      return;
    }

    players[socket.id] = { id: socket.id, username, seed };
    lockedSeeds.add(seed);
    socket.emit('init', { calledNumbers: Array.from(calledNumbers) });
    broadcastPlayers();
    startCountdownIfNeeded();
  });

  socket.on('bingo', (card) => {
    if (!gameStarted || winnerInfo) return;
    winnerInfo = {
      username: players[socket.id]?.username || 'Unknown',
      card
    };
    io.emit('winner', winnerInfo);
    clearInterval(callInterval);
  });

  socket.on('playAgain', () => {
    resetGame();
  });

  socket.on('disconnect', () => {
    const player = players[socket.id];
    if (player) {
      lockedSeeds.delete(player.seed);
      delete players[socket.id];
    }
    broadcastPlayers();
    console.log('User disconnected:', socket.id);
  });
});

server.listen(3000, () => {
  console.log('✅ Bingo server running at http://localhost:3000');
});

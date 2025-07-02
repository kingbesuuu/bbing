
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

let players = {};
let lockedSeeds = new Set();
let calledNumbers = new Set();
let callPool = [];
let callInterval = null;
let gameStarted = false;
let countdownTime = 60;
let countdownTimer = null;
let winnerInfo = null;

function broadcastPlayerList() {
  io.emit('players', Object.values(players));
}

function startCountdown() {
  if (countdownTimer || gameStarted) return;

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

function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  callPool = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  calledNumbers = new Set();
  io.emit('gameStarted');
  callInterval = setInterval(() => {
    if (callPool.length === 0) return;
    const number = callPool.shift();
    calledNumbers.add(number);
    io.emit('numberCalled', number);
  }, 10000); // every 10 seconds
}

function resetGame() {
  players = {};
  lockedSeeds = new Set();
  calledNumbers = new Set();
  callPool = [];
  gameStarted = false;
  winnerInfo = null;
  clearInterval(callInterval);
  clearInterval(countdownTimer);
  countdownTimer = null;
  callInterval = null;
  io.emit('reset');
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('register', ({ username, seed }) => {
    if (gameStarted) {
      socket.emit('blocked', 'Game already started');
      return;
    }
    if (lockedSeeds.has(seed)) {
      socket.emit('blocked', 'Seed already taken');
      return;
    }
    players[socket.id] = { id: socket.id, username, seed };
    lockedSeeds.add(seed);
    socket.emit('init', { calledNumbers: Array.from(calledNumbers) });
    broadcastPlayerList();

    if (Object.keys(players).length >= 2) {
      startCountdown();
    }
  });

  socket.on('bingo', (card) => {
    if (!gameStarted || winnerInfo) return;
    winnerInfo = { username: players[socket.id]?.username || 'Unknown', card };
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
    broadcastPlayerList();
    console.log('Player disconnected:', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Bingo server running on http://localhost:3000');
});

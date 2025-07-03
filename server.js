const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser'); // ✅ Import first

const app = express();
app.use(bodyParser.json()); // ✅ Then use it
const server = http.createServer(app);
const io = socketIO(server);

// 🔐 Admin & Balance
const balances = {};          // username => balance
const userSocketMap = {};     // username => socket.id
const ADMIN_SECRET = 'changeme'; // same as in admin.html

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🧠 Game state
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

// ✅ BALANCE UPDATE FUNCTION
function updatePlayerBalanceByUsername(username, newBalance) {
  if (!username || typeof newBalance !== 'number') {
    throw new Error('Invalid username or balance value');
  }

  balances[username] = newBalance;

  const socketId = userSocketMap[username];
  if (socketId && io.sockets.sockets.get(socketId)) {
    io.to(socketId).emit('balanceUpdate', newBalance);
  }

  console.log(`✅ Updated balance for @${username} to ${newBalance}`);
}

// ✅ ADMIN API
app.post('/admin/update-balance', (req, res) => {
  const authHeader = req.headers.authorization;
  const { username, amount } = req.body;

  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    updatePlayerBalanceByUsername(username, amount);
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ✅ SOCKET.IO HANDLING
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

    userSocketMap[username] = socket.id;

// ✅ Set default balance if not already set
if (!(username in balances)) {
  balances[username] = 0; // 🎁 
}

socket.emit('init', {
  calledNumbers: Array.from(calledNumbers),
  balance: balances[username],
});

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
      delete userSocketMap[player.username];
      delete players[socket.id];
    }
    broadcastPlayers();
    console.log('User disconnected:', socket.id);
  });
});

// ✅ START SERVER
server.listen(3000, () => {
  console.log('✅ Bingo server running at http://localhost:3000');
});

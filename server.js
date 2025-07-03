const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser'); // ✅ Import first
const fs = require('fs');                   // <--- Added here
const DB_FILE = path.join(__dirname, 'db.json'); // <--- Added here

const app = express();
app.use(bodyParser.json()); // ✅ Then use it
const server = http.createServer(app);
const io = socketIO(server);

// 🔐 Admin & Balance
const balances = {};          // username => balance
const userSocketMap = {};     // username => socket.id
const ADMIN_SECRET = 'changeme'; // same as in admin.html

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

// Stored players loaded from file
let storedPlayers = {};  // full player info from db.json

// Load players from db.json, fill balances and lockedSeeds
function loadPlayers() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE);
      const obj = JSON.parse(data);
      if (obj.players) {
        storedPlayers = obj.players;
        for (const username in storedPlayers) {
          balances[username] = storedPlayers[username].balance || 0;
          lockedSeeds.add(storedPlayers[username].seed);
        }
        console.log('✅ Loaded players from db.json');
      }
    } catch (e) {
      console.error('❌ Failed to load players:', e);
    }
  }
}

loadPlayers(); // <--- Call it here to initialize data before server logic

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function broadcastPlayers() {
  io.emit('players', Object.values(players));
}

function startCountdownIfNeeded() {
  console.log('👥 Player count:', Object.keys(players).length);
  console.log('🎮 Game started:', gameStarted);
  console.log('⏱ Timer running:', !!countdownTimer);

  if (Object.keys(players).length >= 2 && !gameStarted && !countdownTimer) {
    countdownTime = 60;
    io.emit('countdown', countdownTime);
    console.log('🚀 Countdown started');

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
  }, 5000); // every 5s
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

function updatePlayerBalanceByUsername(username, newBalance) {
  if (!username || typeof newBalance !== 'number') {
    throw new Error('Invalid username or balance value');
  }

  // Set balance in memory
  balances[username] = newBalance;

  // If player is connected, notify them
  const socketId = userSocketMap[username];
  if (socketId && io.sockets.sockets.get(socketId)) {
    io.to(socketId).emit('balanceUpdate', newBalance);
    console.log(`✅ Sent balanceUpdate to connected user @${username}`);
  } else {
    console.log(`⚠️ Stored balance for @${username} (user not currently connected)`);
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

  if (!username || typeof amount !== 'number') {
    return res.status(400).json({ error: 'Invalid username or amount' });
  }

  try {
    updatePlayerBalanceByUsername(username, amount);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ✅ SOCKET.IO HANDLING
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', ({ username, seed }) => {
    if ((balances[username] || 0) < 10) {
      socket.emit('blocked', 'Not enough balance to play. Please top up.');
      return;
    }

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

    socket.emit('init', {
      calledNumbers: Array.from(calledNumbers),
      balance: balances[username] || 0,
      lockedSeeds: Array.from(lockedSeeds),
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
'use strict';
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const path         = require('path');
const cookieParser = require('cookie-parser');

const authRouter    = require('./src/routes/auth');
const apiRouter     = require('./src/routes/api');
const { roomSessions } = require('./src/state');
const initSocket    = require('./src/socket');
const startGameLoop = require('./src/socket/gameLoop');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRouter);
apiRouter.setRoomSessions(() => roomSessions);
app.use('/api', apiRouter);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initSocket(io);
startGameLoop(io);

module.exports = { app, server };

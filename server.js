const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const users = {};
const waitingUsers = [];

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('join', ({ username }) => {
        users[socket.id] = { username, socket };

        if (waitingUsers.length > 0) {
            const partnerId = waitingUsers.pop();
            const partnerSocket = users[partnerId].socket;

            users[socket.id].partner = partnerId;
            users[partnerId].partner = socket.id;

            socket.emit('offer', partnerSocket.id);
            partnerSocket.emit('offer', socket.id);
        } else {
            waitingUsers.push(socket.id);
        }
    });

    socket.on('offer', (offer) => {
        const partnerId = users[socket.id].partner;
        if (partnerId) {
            users[partnerId].socket.emit('offer', offer);
        }
    });

    socket.on('answer', (answer) => {
        const partnerId = users[socket.id].partner;
        if (partnerId) {
            users[partnerId].socket.emit('answer', answer);
        }
    });

    socket.on('candidate', (candidate) => {
        const partnerId = users[socket.id].partner;
        if (partnerId) {
            users[partnerId].socket.emit('candidate', candidate);
        }
    });

    socket.on('chatMessage', ({ username, message }) => {
        const partnerId = users[socket.id].partner;
        if (partnerId) {
            users[partnerId].socket.emit('chatMessage', { username, message });
        }
    });

    socket.on('endCall', () => {
        handleEndCall(socket.id);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        handleEndCall(socket.id);
        delete users[socket.id];
    });

    function handleEndCall(socketId) {
        const partnerId = users[socketId]?.partner;

        if (partnerId) {
            users[partnerId].socket.emit('endCall');
            delete users[partnerId].partner;
        }

        if (waitingUsers.includes(socketId)) {
            waitingUsers.splice(waitingUsers.indexOf(socketId), 1);
        } else if (waitingUsers.includes(partnerId)) {
            waitingUsers.splice(waitingUsers.indexOf(partnerId), 1);
        }

        delete users[socketId].partner;
        waitingUsers.push(socketId);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Room and user management
const issueRooms = new Map(); // Store rooms by issue
const userRooms = new Map(); // Track which room each user is in

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', ({ issue, username }) => {
        const room = findOrCreateRoom(issue);
        socket.join(room.roomId);
        room.users.push({ id: socket.id, username });
        userRooms.set(socket.id, room);

        const isInitiator = room.users.length === 1;
        socket.emit('joinedRoom', { roomId: room.roomId, isInitiator });

        if (room.users.length === 2) {
            io.to(room.roomId).emit('startVideoChat');
        }

        console.log(`User ${username} (${socket.id}) joined room: ${room.roomId} for issue: ${issue}`);
    });

    socket.on('offer', (offer) => {
        const room = userRooms.get(socket.id);
        if (room) {
            socket.to(room.roomId).emit('offer', offer);
        }
    });

    socket.on('answer', (answer) => {
        const room = userRooms.get(socket.id);
        if (room) {
            socket.to(room.roomId).emit('answer', answer);
        }
    });

    socket.on('iceCandidate', (candidate) => {
        const room = userRooms.get(socket.id);
        if (room) {
            socket.to(room.roomId).emit('iceCandidate', candidate);
        }
    });

    socket.on('chatMessage', (msg) => {
        const room = userRooms.get(socket.id);
        if (room) {
            io.to(room.roomId).emit('chatMessage', { username: msg.username, message: msg.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const room = userRooms.get(socket.id);
        if (room) {
            room.users = room.users.filter(user => user.id !== socket.id);
            socket.to(room.roomId).emit('endCall'); // Notify the remaining user
            userRooms.delete(socket.id);
            if (room.users.length === 0) {
                issueRooms.get(room.issue).delete(room.roomId); // Remove empty room
            }
        }
    });
});

function findOrCreateRoom(issue) {
    if (!issueRooms.has(issue)) {
        issueRooms.set(issue, new Map());
    }

    const rooms = issueRooms.get(issue);
    for (const room of rooms.values()) {
        if (room.users.length < 2) {
            return room;
        }
    }

    const roomId = generateRoomId();
    const newRoom = { roomId, issue, users: [] };
    rooms.set(roomId, newRoom);
    return newRoom;
}

function generateRoomId() {
    return 'room_' + Math.random().toString(36).substring(2, 9);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

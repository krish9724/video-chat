const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Store waiting users by topic and manage active connections
const topicQueues = new Map(); // topic -> Array of waiting users
const activeRooms = new Map();  // roomId -> room object
const userConnections = new Map(); // socketId -> { roomId, username, topic }

function addToQueue(socket, topic, username) {
    if (!topicQueues.has(topic)) {
        topicQueues.set(topic, []);
    }
    topicQueues.get(topic).push({ socketId: socket.id, username });
    console.log(`User ${username} added to queue for topic ${topic}`);
}

function removeFromQueue(socket, topic) {
    if (topicQueues.has(topic)) {
        const queue = topicQueues.get(topic);
        const index = queue.findIndex(user => user.socketId === socket.id);
        if (index !== -1) {
            queue.splice(index, 1);
            console.log(`User ${socket.id} removed from queue for topic ${topic}`);
        }
    }
}

function createRoom(user1, user2, topic) {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const room = {
        id: roomId,
        topic,
        users: new Set([user1.socketId, user2.socketId]),
        usernames: {
            [user1.socketId]: user1.username,
            [user2.socketId]: user2.username
        }
    };
    activeRooms.set(roomId, room);

    // Update user connections
    userConnections.set(user1.socketId, { roomId, username: user1.username, topic });
    userConnections.set(user2.socketId, { roomId, username: user2.username, topic });

    return room;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', ({ topic, username }) => {
        console.log(`User ${username} (${socket.id}) requesting to join topic: ${topic}`);

        // Remove user from any existing room
        const currentConnection = userConnections.get(socket.id);
        if (currentConnection) {
            const currentRoom = activeRooms.get(currentConnection.roomId);
            if (currentRoom) {
                currentRoom.users.delete(socket.id);
                socket.leave(currentRoom.id);
                // Notify other user
                socket.to(currentRoom.id).emit('userDisconnected');
            }
        }

        // Check if there are waiting users for this topic
        if (topicQueues.has(topic) && topicQueues.get(topic).length > 0) {
            const waitingUser = topicQueues.get(topic).shift();
            const room = createRoom(
                { socketId: waitingUser.socketId, username: waitingUser.username },
                { socketId: socket.id, username }
            );

            // Join both users to the room
            socket.join(room.id);
            io.sockets.sockets.get(waitingUser.socketId)?.join(room.id);

            // Notify both users
            io.to(waitingUser.socketId).emit('joinedRoom', { 
                roomId: room.id,
                isInitiator: true
            });
            socket.emit('joinedRoom', {
                roomId: room.id,
                isInitiator: false
            });

            console.log(`Matched users in room ${room.id} for topic ${topic}`);
        } else {
            // Add user to waiting queue
            addToQueue(socket, topic, username);
            socket.emit('joinedRoom', {
                roomId: null,
                isInitiator: true,
                waiting: true
            });
        }
    });

    socket.on('nextPartner', ({ topic, username }) => {
        const currentConnection = userConnections.get(socket.id);
        if (currentConnection) {
            const currentRoom = activeRooms.get(currentConnection.roomId);
            if (currentRoom) {
                currentRoom.users.delete(socket.id);
                socket.leave(currentRoom.id);
                socket.to(currentRoom.id).emit('userDisconnected');
            }
        }

        // Try to find a waiting user
        if (topicQueues.has(topic) && topicQueues.get(topic).length > 0) {
            const waitingUser = topicQueues.get(topic).shift();
            const room = createRoom(
                { socketId: waitingUser.socketId, username: waitingUser.username },
                { socketId: socket.id, username }
            );

            socket.join(room.id);
            io.sockets.sockets.get(waitingUser.socketId)?.join(room.id);

            io.to(waitingUser.socketId).emit('joinedRoom', {
                roomId: room.id,
                isInitiator: true
            });
            socket.emit('joinedRoom', {
                roomId: room.id,
                isInitiator: false
            });
        } else {
            addToQueue(socket, topic, username);
            socket.emit('joinedRoom', {
                roomId: null,
                isInitiator: true,
                waiting: true
            });
        }
    });

    // WebRTC signaling
    socket.on('offer', ({ offer, roomId }) => {
        console.log(`Processing WebRTC offer for room ${roomId}`);
        socket.to(roomId).emit('offer', { offer, roomId });
    });

    socket.on('answer', ({ answer, roomId }) => {
        console.log(`Processing WebRTC answer for room ${roomId}`);
        socket.to(roomId).emit('answer', { answer, roomId });
    });

    socket.on('iceCandidate', ({ candidate, roomId }) => {
        console.log(`Processing ICE candidate for room ${roomId}`);
        socket.to(roomId).emit('iceCandidate', { candidate, roomId });
    });

    // Add chat message handling
    socket.on('message', ({ roomId, message, username }) => {
        console.log(`Processing chat message from ${username} in room ${roomId}`);
        const room = activeRooms.get(roomId);
        if (room && room.users.has(socket.id)) {
            // Send message to all other users in the room
            socket.to(roomId).emit('message', { 
                message, 
                username 
            });
            console.log(`Message sent to room ${roomId}`);
        } else {
            console.log(`Message not sent: User not in room ${roomId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const connection = userConnections.get(socket.id);
        if (connection) {
            const room = activeRooms.get(connection.roomId);
            if (room) {
                room.users.delete(socket.id);
                socket.to(room.id).emit('userDisconnected');
                if (room.users.size === 0) {
                    activeRooms.delete(room.id);
                }
            }
            removeFromQueue(socket, connection.topic);
            userConnections.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
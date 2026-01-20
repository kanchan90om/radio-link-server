// server.js - Socket.IO Signaling Server for Radio Link
// Run with: node server.js

const { Server } = require("socket.io");
const http = require("http");

const PORT = process.env.PORT || 3001;

// Create HTTP server and Socket.IO instance
const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*", // In production, set to your domain
    methods: ["GET", "POST"],
  },
});

// State management
const users = new Map(); // socketId -> { id, nickname }
let currentSpeaker = null; // socketId of current speaker

io.on("connection", (socket) => {
  console.log(`[Server] New connection: ${socket.id}`);

  // Handle user joining the channel
  socket.on("join-channel", ({ nickname }) => {
    console.log(`[Server] User joining: ${nickname} (${socket.id})`);
    
    // Store user info
    users.set(socket.id, { id: socket.id, nickname });
    
    // Get list of existing users (excluding self)
    const existingUsers = Array.from(users.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, user]) => ({ id, nickname: user.nickname }));
    
    // Send welcome with user ID and existing users
    socket.emit("welcome", {
      userId: socket.id,
      users: existingUsers,
    });
    
    // Notify others about new user
    socket.broadcast.emit("user-joined", {
      userId: socket.id,
      nickname,
    });
    
    // Send current speaker status if someone is speaking
    if (currentSpeaker) {
      const speaker = users.get(currentSpeaker);
      socket.emit("speaker-changed", {
        speakerId: currentSpeaker,
        nickname: speaker?.nickname || null,
      });
    }
  });

  // Handle speak request (mutex)
  socket.on("request-speak", () => {
    console.log(`[Server] Speak request from: ${socket.id}`);
    
    // Only allow if no one is speaking or same user
    if (currentSpeaker === null || currentSpeaker === socket.id) {
      currentSpeaker = socket.id;
      const user = users.get(socket.id);
      
      // Broadcast speaker change to all users
      io.emit("speaker-changed", {
        speakerId: socket.id,
        nickname: user?.nickname || null,
      });
      
      console.log(`[Server] Speaker set to: ${socket.id}`);
    }
  });

  // Handle speak release
  socket.on("release-speak", () => {
    console.log(`[Server] Speak release from: ${socket.id}`);
    
    if (currentSpeaker === socket.id) {
      currentSpeaker = null;
      
      // Broadcast channel is free
      io.emit("speaker-changed", {
        speakerId: null,
        nickname: null,
      });
      
      console.log(`[Server] Channel is now free`);
    }
  });

  // WebRTC signaling: Offer
  socket.on("offer", ({ toUserId, offer }) => {
    console.log(`[Server] Relaying offer from ${socket.id} to ${toUserId}`);
    io.to(toUserId).emit("offer", {
      fromUserId: socket.id,
      offer,
    });
  });

  // WebRTC signaling: Answer
  socket.on("answer", ({ toUserId, answer }) => {
    console.log(`[Server] Relaying answer from ${socket.id} to ${toUserId}`);
    io.to(toUserId).emit("answer", {
      fromUserId: socket.id,
      answer,
    });
  });

  // WebRTC signaling: ICE Candidate
  socket.on("ice-candidate", ({ toUserId, candidate }) => {
    console.log(`[Server] Relaying ICE candidate from ${socket.id} to ${toUserId}`);
    io.to(toUserId).emit("ice-candidate", {
      fromUserId: socket.id,
      candidate,
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`[Server] User disconnected: ${socket.id}`);
    
    const user = users.get(socket.id);
    
    // Release speaker if disconnecting user was speaking
    if (currentSpeaker === socket.id) {
      currentSpeaker = null;
      io.emit("speaker-changed", {
        speakerId: null,
        nickname: null,
      });
    }
    
    // Remove user
    users.delete(socket.id);
    
    // Notify others
    socket.broadcast.emit("user-left", {
      userId: socket.id,
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Server] Radio Link signaling server running on port ${PORT}`);
  console.log(`[Server] WebSocket URL: ws://localhost:${PORT}`);
});
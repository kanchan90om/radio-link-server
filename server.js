const { createServer } = require('http');
const { Server } = require('socket.io');

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Store channels: { channelCode: { users: Map, currentSpeaker: null } }
const channels = new Map();

function getOrCreateChannel(channelCode) {
  if (!channels.has(channelCode)) {
    channels.set(channelCode, { users: new Map(), currentSpeaker: null });
  }
  return channels.get(channelCode);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  let currentChannel = null;

  socket.on('join-channel', ({ nickname, channelCode }) => {
    const code = channelCode || 'DEFAULT';
    currentChannel = code;
    const channel = getOrCreateChannel(code);
    
    // Join socket.io room for this channel
    socket.join(code);
    channel.users.set(socket.id, nickname);
    
    console.log(`${nickname} (${socket.id}) joined channel ${code}`);

    // Send welcome with existing users in this channel
    const existingUsers = [];
    channel.users.forEach((name, id) => {
      if (id !== socket.id) existingUsers.push({ id, nickname: name });
    });
    
    socket.emit('welcome', { 
      userId: socket.id, 
      users: existingUsers,
      channelCode: code 
    });

    // Notify others in the same channel
    socket.to(code).emit('user-joined', { userId: socket.id, nickname });
  });

  socket.on('request-speak', () => {
    if (!currentChannel) return;
    const channel = channels.get(currentChannel);
    if (!channel) return;
    
    if (channel.currentSpeaker === null) {
      channel.currentSpeaker = socket.id;
      const nickname = channel.users.get(socket.id);
      io.to(currentChannel).emit('speaker-changed', { speakerId: socket.id, nickname });
    }
  });

  socket.on('release-speak', () => {
    if (!currentChannel) return;
    const channel = channels.get(currentChannel);
    if (!channel) return;
    
    if (channel.currentSpeaker === socket.id) {
      channel.currentSpeaker = null;
      io.to(currentChannel).emit('speaker-changed', { speakerId: null, nickname: null });
    }
  });

  socket.on('offer', ({ toUserId, offer }) => {
    io.to(toUserId).emit('offer', { fromUserId: socket.id, offer });
  });

  socket.on('answer', ({ toUserId, answer }) => {
    io.to(toUserId).emit('answer', { fromUserId: socket.id, answer });
  });

  socket.on('ice-candidate', ({ toUserId, candidate }) => {
    io.to(toUserId).emit('ice-candidate', { fromUserId: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (currentChannel) {
      const channel = channels.get(currentChannel);
      if (channel) {
        const nickname = channel.users.get(socket.id);
        channel.users.delete(socket.id);
        
        if (channel.currentSpeaker === socket.id) {
          channel.currentSpeaker = null;
          io.to(currentChannel).emit('speaker-changed', { speakerId: null, nickname: null });
        }
        
        socket.to(currentChannel).emit('user-left', { userId: socket.id });
        
        // Clean up empty channels
        if (channel.users.size === 0) {
          channels.delete(currentChannel);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));
                      

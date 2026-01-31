// ==================== 此刻地图后端服务器 ====================
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// 创建应用
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 静态文件服务

// ==================== 数据存储（简单版，用内存存储） ====================
let bubbles = []; // 所有气泡
let users = [];   // 所有用户
let onlineUsers = 0; // 在线人数

// ==================== API接口 ====================

// 1. 用户登录
app.post('/api/auth/login', (req, res) => {
  const { phone, code } = req.body;
  
  console.log('登录请求:', phone);
  
  // 简单验证（测试阶段）
  if (code !== '123456') {
    return res.json({ success: false, message: '验证码错误' });
  }
  
  // 查找或创建用户
  let user = users.find(u => u.phone === phone);
  if (!user) {
    user = {
      id: 'USER_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      phone: phone,
      nickname: '用户' + phone.slice(-4),
      avatar: '👤',
      createdAt: Date.now()
    };
    users.push(user);
    console.log('新用户注册:', user.nickname);
  } else {
    console.log('用户登录:', user.nickname);
  }
  
  res.json({
    success: true,
    token: 'token_' + user.id,
    user: user
  });
});

// 2. 发布气泡
app.post('/api/bubbles', (req, res) => {
  const bubble = {
    id: 'bubble_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    ...req.body,
    createdAt: Date.now()
  };
  
  bubbles.push(bubble);
  console.log('新气泡发布:', bubble.title);
  
  // 实时推送给所有连接的客户端
  io.emit('newBubble', bubble);
  
  res.json({ success: true, bubble });
});

// 3. 获取气泡列表
app.get('/api/bubbles', (req, res) => {
  const { lat, lng, range, locationKey } = req.query;
  
  const now = Date.now();
  
  // 过滤掉过期的气泡
  let filteredBubbles = bubbles.filter(b => {
    const expireTime = b.createdAt + (b.duration * 1000);
    if (now >= expireTime) return false;
    
    // 如果指定了locationKey，只返回该区域的气泡
    if (locationKey && b.locationKey !== locationKey) return false;
    
    // 简单距离筛选（实际项目可以用更精确的算法）
    if (lat && lng && range) {
      const distance = calculateDistance(
        parseFloat(lat),
        parseFloat(lng),
        b.lat,
        b.lng
      );
      if (distance > parseFloat(range)) return false;
    }
    
    return true;
  });
  
  console.log(`返回气泡数量: ${filteredBubbles.length}`);
  
  res.json({ success: true, bubbles: filteredBubbles });
});

// 4. 删除气泡（可选）
app.delete('/api/bubbles/:id', (req, res) => {
  const { id } = req.params;
  const index = bubbles.findIndex(b => b.id === id);
  
  if (index > -1) {
    bubbles.splice(index, 1);
    console.log('删除气泡:', id);
    res.json({ success: true });
  } else {
    res.json({ success: false, message: '气泡不存在' });
  }
});

// ==================== Socket.IO 实时通信 ====================

io.on('connection', (socket) => {
  onlineUsers++;
  console.log(`用户连接，当前在线: ${onlineUsers}`);
  io.emit('onlineCount', onlineUsers);
  
  // 用户加入
  socket.on('userJoin', (user) => {
    console.log('用户加入:', user.nickname || user.id);
    socket.userId = user.id;
    socket.userNickname = user.nickname;
  });
  
  // 加入聊天室
  socket.on('joinChatroom', (chatroomId) => {
    socket.join(chatroomId);
    console.log(`${socket.userNickname} 加入聊天室: ${chatroomId}`);
    
    // 通知聊天室内的人
    io.to(chatroomId).emit('chatroomUserJoined', {
      nickname: socket.userNickname,
      time: Date.now()
    });
  });
  
  // 聊天室消息
  socket.on('chatroomMessage', (data) => {
    console.log(`聊天室消息 [${data.chatroomId}]: ${data.message}`);
    
    io.to(data.chatroomId).emit('newMessage', {
      nickname: socket.userNickname || '匿名用户',
      message: data.message,
      time: Date.now()
    });
  });
  
  // 离开聊天室
  socket.on('leaveChatroom', (chatroomId) => {
    socket.leave(chatroomId);
    console.log(`${socket.userNickname} 离开聊天室: ${chatroomId}`);
  });
  
  // 用户断开连接
  socket.on('disconnect', () => {
    onlineUsers--;
    console.log(`用户断开，当前在线: ${onlineUsers}`);
    io.emit('onlineCount', onlineUsers);
  });
});

// ==================== 工具函数 ====================

// 计算两点之间的距离（米）
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ==================== 定时清理过期气泡 ====================
setInterval(() => {
  const now = Date.now();
  const beforeCount = bubbles.length;
  
  bubbles = bubbles.filter(b => {
    const expireTime = b.createdAt + (b.duration * 1000);
    return now < expireTime;
  });
  
  const afterCount = bubbles.length;
  if (beforeCount !== afterCount) {
    console.log(`清理过期气泡: ${beforeCount} → ${afterCount}`);
  }
}, 60000); // 每分钟清理一次

// ==================== 启动服务器 ====================
const PORT = 3000;
server.listen(PORT, () => {
  console.log('====================================');
  console.log('🚀 此刻地图后端服务器启动成功！');
  console.log(`📡 本地访问: http://localhost:${PORT}`);
  console.log(`📡 局域网访问: http://你的IP地址:${PORT}`);
  console.log('====================================');
});

// ==================== 优雅退出 ====================
process.on('SIGINT', () => {
  console.log('\n服务器正在关闭...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

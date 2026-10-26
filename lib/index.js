// ========================================
// 服务端主入口 - Cordis 插件 (Phase 2: WebSocket)
// ========================================

import Database from 'better-sqlite3'
import { WebSocketServer } from 'ws'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { randomBytes } from 'crypto'

export const name = 'chatroom'
// webServer 用于注册 /chatroom-api 路由；deepseekAccount 用于读取登录用户
export const inject = ['webServer', 'deepseekAccount']

// ===== 工具函数 =====

function generateId(prefix) {
  const bytes = randomBytes(8).toString('hex')
  return prefix ? `${prefix}-${bytes}` : bytes
}

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  const bytes = randomBytes(6)
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length]
  }
  return code
}

// ===== 附件与 HTTP 辅助 =====

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MESSAGE_ID_PATTERN = /^msg-[A-Za-z0-9_-]{8,80}$/

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function cleanFileName(value) {
  const name = path.basename(String(value || '未命名文件').replace(/\\/g, '/'))
    .replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180)
  return name || '未命名文件'
}

function normalizeMessageId(value) {
  if (value == null || value === '') return null
  const id = String(value)
  if (!MESSAGE_ID_PATTERN.test(id)) throw httpError(400, '附件消息 ID 无效')
  return id
}

function detectImageMime(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

function resolveMimeType(value, data) {
  const declared = String(value || '').split(';')[0].trim().toLowerCase()
  const detected = detectImageMime(data)
  if (detected) return detected
  if (declared.startsWith('image/')) {
    if (!IMAGE_MIME_TYPES.has(declared)) return 'application/octet-stream'
    throw httpError(415, '图片内容无效或格式不符，仅支持 PNG、JPEG、WebP、GIF')
  }
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(declared)
    ? declared : 'application/octet-stream'
}

function publicAttachment(attachment) {
  return {
    id: attachment.id,
    messageId: attachment.messageId,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    uploadedAt: attachment.uploadedAt,
    url: '/chatroom-api/attachments/' + encodeURIComponent(attachment.id)
  }
}

function publicMessage(message) {
  return { ...message, attachments: (message.attachments || []).map(publicAttachment) }
}

function readRequestBody(req, maxBytes) {
  const length = Number(req.headers['content-length'] || 0)
  if (length > maxBytes) {
    req.resume()
    return Promise.reject(httpError(413, `文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`))
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let overflow = false
    req.on('data', chunk => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += data.length
      if (size > maxBytes) overflow = true
      else if (!overflow) chunks.push(data)
    })
    req.on('end', () => overflow
      ? reject(httpError(413, `文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`))
      : resolve(Buffer.concat(chunks)))
    req.on('aborted', () => reject(httpError(400, '上传已中断')))
    req.on('error', reject)
  })
}

function contentDisposition(kind, fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

// ===== 存储管理器 =====

class StorageManager {
  constructor(config) {
    this.config = config
    this.filesDir = path.join(config.basePath, 'files')
    this.thumbnailsDir = path.join(config.basePath, 'thumbnails')
    this._ensureDirectories()
  }

  static defaultBasePath() {
    const dshHome = process.env.DSH_HOME
    return dshHome
      ? path.join(dshHome, 'chatroom')
      : path.join(os.homedir(), '.dsh', 'chatroom')
  }

  _ensureDirectories() {
    for (const dir of [this.config.basePath, this.filesDir, this.thumbnailsDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }
  }

  get dbPath() { return path.join(this.config.basePath, 'chatroom.db') }
  get basePath() { return this.config.basePath }

  getFilePath(roomId, fileId, fileName) {
    const now = new Date()
    const ext = path.extname(cleanFileName(fileName)).slice(0, 16)
    const dir = path.join(this.filesDir, String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'), roomId)
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, fileId + ext)
  }
}

// ===== 数据库管理器 =====

class ChatroomDatabase {
  constructor(dbPath) {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this._initSchema()
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        invite_code TEXT UNIQUE,
        invite_code_expiry INTEGER,
        settings TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        muted_until INTEGER,
        PRIMARY KEY (room_id, user_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        timestamp INTEGER NOT NULL,
        read_by TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room_time
        ON messages(room_id, timestamp DESC);
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        local_path TEXT NOT NULL,
        thumbnail_path TEXT,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_members_user
        ON members(user_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_message
        ON attachments(message_id);
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY,
        nickname TEXT,
        avatar_path TEXT,
        avatar_mime TEXT,
        updated_at INTEGER NOT NULL
      );
    `)
    const columns = this.db.prepare('PRAGMA table_info(attachments)').all()
    if (!columns.some(column => column.name === 'position')) {
      this.db.exec('ALTER TABLE attachments ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
    }
    // 早期原型把 message_id 声明为 NOT NULL；重建一次以支持先上传、后发送。
    if (columns.find(column => column.name === 'message_id')?.notnull) {
      const migrate = this.db.transaction(() => {
        this.db.exec(`
          DROP INDEX IF EXISTS idx_attachments_message;
          ALTER TABLE attachments RENAME TO attachments_legacy;
          CREATE TABLE attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT,
            file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            local_path TEXT NOT NULL,
            thumbnail_path TEXT,
            uploaded_by TEXT NOT NULL,
            uploaded_at INTEGER NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
          );
          INSERT INTO attachments SELECT * FROM attachments_legacy;
          DROP TABLE attachments_legacy;
          CREATE INDEX idx_attachments_message ON attachments(message_id);
        `)
      })
      migrate()
    }
  }

  createRoom(room) {
    this.db.prepare(`
      INSERT INTO rooms (id, name, owner_id, invite_code, invite_code_expiry, settings, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(room.id, room.name, room.ownerId, room.inviteCode,
           room.inviteCodeExpiry || null, JSON.stringify(room.settings), room.createdAt)
  }

  getRoomById(roomId) {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId)
    return row ? this._rowToRoom(row) : null
  }

  getRoomByInviteCode(code) {
    const row = this.db.prepare('SELECT * FROM rooms WHERE invite_code = ?').get(code)
    return row ? this._rowToRoom(row) : null
  }

  getUserRooms(userId) {
    return this.db.prepare(`
      SELECT r.* FROM rooms r
      INNER JOIN members m ON r.id = m.room_id
      WHERE m.user_id = ?
      ORDER BY r.created_at DESC
    `).all(userId).map(r => this._rowToRoom(r))
  }

  updateInviteCode(roomId, code, expiry) {
    this.db.prepare('UPDATE rooms SET invite_code = ?, invite_code_expiry = ? WHERE id = ?')
      .run(code, expiry || null, roomId)
  }

  _rowToRoom(row) {
    return {
      id: row.id, name: row.name, ownerId: row.owner_id,
      inviteCode: row.invite_code, inviteCodeExpiry: row.invite_code_expiry,
      settings: JSON.parse(row.settings), createdAt: row.created_at
    }
  }

  addMember(member) {
    this.db.prepare(`
      INSERT INTO members (room_id, user_id, nickname, role, joined_at, muted_until)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(member.roomId, member.userId, member.nickname, member.role,
           member.joinedAt, member.mutedUntil || null)
  }

  getMember(roomId, userId) {
    const row = this.db.prepare('SELECT * FROM members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
    return row ? this._rowToMember(row) : null
  }

  getRoomMembers(roomId) {
    return this.db.prepare('SELECT * FROM members WHERE room_id = ? ORDER BY joined_at ASC')
      .all(roomId).map(r => {
        const member = this._rowToMember(r)
        const profile = this.getProfile(member.userId)
        return { ...member, avatarUrl: profile && profile.avatarPath ? '/chatroom-api/avatar/' + encodeURIComponent(member.userId) + '?v=' + profile.updatedAt : null }
      })
  }

  updateMemberNickname(roomId, userId, nickname) {
    this.db.prepare('UPDATE members SET nickname = ? WHERE room_id = ? AND user_id = ?')
      .run(nickname, roomId, userId)
  }

  updateMemberMute(roomId, userId, mutedUntil) {
    this.db.prepare('UPDATE members SET muted_until = ? WHERE room_id = ? AND user_id = ?')
      .run(mutedUntil, roomId, userId)
  }

  _rowToMember(row) {
    return {
      roomId: row.room_id, userId: row.user_id, nickname: row.nickname,
      role: row.role, joinedAt: row.joined_at, mutedUntil: row.muted_until
    }
  }

  addMessage(message) {
    this.db.prepare(`
      INSERT INTO messages (id, room_id, sender_id, sender_name, content, type, timestamp, read_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(message.id, message.roomId, message.senderId, message.senderName,
           message.content, message.type, message.timestamp, JSON.stringify(message.readBy))
  }

  getMessages(roomId, limit = 50, before) {
    const rows = before
      ? this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?').all(roomId, before, limit)
      : this.db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?').all(roomId, limit)

    return rows.map(row => ({
      id: row.id, roomId: row.room_id, senderId: row.sender_id,
      senderName: row.sender_name, content: row.content, type: row.type,
      timestamp: row.timestamp, readBy: JSON.parse(row.read_by),
      attachments: this.getMessageAttachments(row.id).map(publicAttachment)
    })).reverse()
  }

  markMessageRead(messageId, userId) {
    const row = this.db.prepare('SELECT read_by FROM messages WHERE id = ?').get(messageId)
    if (!row) return
    const readBy = JSON.parse(row.read_by)
    if (!readBy.includes(userId)) {
      readBy.push(userId)
      this.db.prepare('UPDATE messages SET read_by = ? WHERE id = ?').run(JSON.stringify(readBy), messageId)
    }
  }

  // 附件暂存时 messageId 为 null；发送消息时再原子绑定到真实消息。
  addAttachment(attachment) {
    this.db.prepare(`
      INSERT INTO attachments (id, message_id, file_name, file_size, mime_type,
        local_path, thumbnail_path, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(attachment.id, attachment.messageId || null, attachment.fileName,
      attachment.fileSize, attachment.mimeType, attachment.localPath, null,
      attachment.uploadedBy, attachment.uploadedAt)
  }

  getAttachment(id) {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id)
    return row ? this._rowToAttachment(row) : null
  }

  getMessageAttachments(messageId) {
    return this.db.prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY position ASC, uploaded_at ASC, id ASC')
      .all(messageId).map(row => this._rowToAttachment(row))
  }

  _rowToAttachment(row) {
    return {
      id: row.id, messageId: row.message_id, fileName: row.file_name,
      fileSize: row.file_size, mimeType: row.mime_type, localPath: row.local_path,
      thumbnailPath: row.thumbnail_path, uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at
    }
  }

  getProfile(userId) {
    const row = this.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
    return row ? {
      userId: row.user_id, nickname: row.nickname, avatarPath: row.avatar_path,
      avatarMime: row.avatar_mime, updatedAt: row.updated_at
    } : null
  }

  upsertProfile({ userId, nickname, avatarPath, avatarMime }) {
    const old = this.getProfile(userId) || {}
    this.db.prepare(`
      INSERT INTO profiles (user_id, nickname, avatar_path, avatar_mime, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        nickname = excluded.nickname, avatar_path = excluded.avatar_path,
        avatar_mime = excluded.avatar_mime, updated_at = excluded.updated_at
    `).run(userId,
      nickname !== undefined ? nickname : old.nickname ?? null,
      avatarPath !== undefined ? avatarPath : old.avatarPath ?? null,
      avatarMime !== undefined ? avatarMime : old.avatarMime ?? null,
      Date.now())
    return this.getProfile(userId)
  }

  _getMessage(id) {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null
  }

  createAttachmentMessage(roomId, content, attachments, user, member, requestedId, tempId, attachmentIds = []) {
    const id = normalizeMessageId(requestedId) || generateId('msg')
    const expectedIds = [...new Set(attachmentIds.map(String))]
    const existing = this._getMessage(id)
    if (existing) {
      if (existing.room_id !== roomId || existing.sender_id !== user.userId || existing.content !== content) {
        throw httpError(409, '消息 ID 已被其他内容使用，请重新发送')
      }
      const existingAttachments = this.getMessageAttachments(id)
      if (expectedIds.join(',') !== existingAttachments.map(file => file.id).join(',')) {
        throw httpError(409, '消息 ID 与附件不匹配，请刷新后重试')
      }
      return { message: publicMessage({
        id: existing.id, roomId: existing.room_id, senderId: existing.sender_id,
        senderName: existing.sender_name, content: existing.content, type: existing.type,
        timestamp: existing.timestamp, readBy: JSON.parse(existing.read_by), attachments: existingAttachments
      }), tempId: typeof tempId === 'string' ? tempId.slice(0, 100) : null, duplicate: true }
    }
    if (!content && attachments.length === 0) throw httpError(400, '请输入消息或选择附件')
    if (attachments.length > 10) throw httpError(400, '每条消息最多包含 10 个附件')
    for (const file of attachments) {
      if (!file || file.uploadedBy !== user.userId) throw httpError(403, '附件不存在或不属于当前用户')
      if (file.messageId) throw httpError(409, '附件已发送，不能重复使用')
    }
    const now = Date.now()
    const types = new Set(attachments.map(file => file.mimeType.startsWith('image/') ? 'image' : 'file'))
    const message = {
      id, roomId, senderId: user.userId, senderName: member.nickname, content,
      type: attachments.length === 0 ? 'text' : types.size === 1 ? [...types][0] : 'mixed',
      timestamp: now, readBy: [user.userId]
    }
    const publish = this.db.transaction(() => {
      this.addMessage(message)
      const bind = this.db.prepare('UPDATE attachments SET message_id = ?, position = ? WHERE id = ? AND message_id IS NULL AND uploaded_by = ?')
      for (let index = 0; index < attachments.length; index++) {
        if (bind.run(id, index, attachments[index].id, user.userId).changes !== 1) throw httpError(409, '附件已被使用，请重新上传')
      }
    })
    publish()
    const published = { ...message, attachments: attachments.map(file => ({ ...file, messageId: id })).map(publicAttachment) }
    return { message: published, tempId: typeof tempId === 'string' ? tempId.slice(0, 100) : null }
  }

  close() { this.db.close() }
}

// ===== WebSocket 服务器 =====

class ChatroomWSSServer {
  constructor(db) {
    this.db = db
    this.wss = null
    this.port = null
    // userId -> Set<ws>
    this.clients = new Map()
    // roomId -> Set<userId>
    this.roomPresence = new Map()
    // roomId -> Map<userId, ts>
    this.typingStates = new Map()
    this._heartbeatTimer = null
  }

  async start(preferredPort = 0) {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: preferredPort })
    await new Promise((resolve, reject) => {
      this.wss.once('listening', resolve)
      this.wss.once('error', reject)
    })
    this.port = this.wss.address().port
    this.wss.on('connection', (ws, req) => this._onConnect(ws, req))
    this._startHeartbeat()

    console.log(`[Chatroom] WebSocket 服务器已启动，端口: ${this.port}`)
    return this.port
  }

  _onConnect(ws, req) {
    const origin = req.headers.origin
    if (origin && origin !== 'null') {
      try {
        const url = new URL(origin)
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return ws.close(1008, 'Invalid origin')
      } catch { return ws.close(1008, 'Invalid origin') }
    }
    ws.isAlive = true
    ws.userId = null
    ws.activeRooms = new Set()

    ws.on('pong', () => { ws.isAlive = true })
    ws.on('message', data => {
      try {
        this._dispatch(ws, JSON.parse(data.toString()))
      } catch (e) {
        this._send(ws, { type: 'error', error: e.message })
      }
    })
    ws.on('close', () => this._onDisconnect(ws))
    ws.on('error', err => console.error('[Chatroom] ws error:', err.message))
  }

  _dispatch(ws, { type, ...data }) {
    switch (type) {
      case 'auth':          return this._handleAuth(ws, data)
      case 'join_room':     return this._handleJoinRoom(ws, data)
      case 'leave_room':    return this._handleLeaveRoom(ws, data)
      case 'send_message':  return this._handleSendMessage(ws, data)
      case 'typing':        return this._handleTyping(ws, data)
      case 'read':          return this._handleRead(ws, data)
      default: this._send(ws, { type: 'error', error: `Unknown type: ${type}` })
    }
  }

  _handleAuth(ws, { token }) {
    const userId = this.authenticate ? this.authenticate(token) : null
    if (!userId) {
      this._send(ws, { type: 'error', error: '认证无效或已过期，请刷新页面' })
      return ws.close(1008, 'Invalid authentication')
    }
    if (ws.userId) return
    ws.userId = userId

    if (!this.clients.has(userId)) this.clients.set(userId, new Set())
    this.clients.get(userId).add(ws)

    this._send(ws, { type: 'auth_ok', userId })
    console.log(`[Chatroom] 用户已认证: ${userId}`)

    // 通知该用户已加入的所有聊天室里的其他人
    for (const room of this.db.getUserRooms(userId)) {
      this._broadcastToRoom(room.id, { type: 'user_online', userId }, userId)
    }
  }

  _handleJoinRoom(ws, { roomId }) {
    if (!this._checkAuth(ws)) return

    const member = this.db.getMember(roomId, ws.userId)
    if (!member) return this._send(ws, { type: 'error', error: '无权限' })

    ws.activeRooms.add(roomId)
    if (!this.roomPresence.has(roomId)) this.roomPresence.set(roomId, new Set())
    this.roomPresence.get(roomId).add(ws.userId)

    // 发送当前在线用户列表
    const onlineUsers = Array.from(this.roomPresence.get(roomId))
    this._send(ws, { type: 'room_joined', roomId, onlineUsers })

    // 通知其他人
    this._broadcastToRoom(roomId, {
      type: 'user_online',
      userId: ws.userId,
      nickname: member.nickname,
      roomId
    }, ws.userId)

    console.log(`[Chatroom] 用户进入聊天室: ${ws.userId} -> ${roomId}`)
  }

  _handleLeaveRoom(ws, { roomId }) {
    if (!ws.userId) return
    ws.activeRooms.delete(roomId)
    this._removeFromRoom(ws.userId, roomId)
    this._broadcastToRoom(roomId, { type: 'user_offline', userId: ws.userId, roomId })
  }

  _handleSendMessage(ws, { roomId, content, attachmentIds, tempId, messageId }) {
    if (!this._checkAuth(ws)) return
    try {
      const member = this.db.getMember(roomId, ws.userId)
      if (!member) throw httpError(403, '无发送权限')
      const text = String(content || '').trim().slice(0, 20000)
      const attachments = this._resolveAttachments(roomId, ws.userId, attachmentIds)
      const result = this.db.createAttachmentMessage(roomId, text, attachments,
        { userId: ws.userId }, member, messageId, tempId, attachmentIds || [])
      if (result.duplicate) this._send(ws, { type: 'new_message', roomId, ...result })
      else this._broadcastToRoom(roomId, { type: 'new_message', roomId, ...result })
      console.log(`[Chatroom] 消息广播: ${result.message.id} in ${roomId}`)
    } catch (error) {
      this._send(ws, { type: 'message_error', roomId, tempId, error: error.message })
    }
  }

  _resolveAttachments(roomId, userId, attachmentIds) {
    if (attachmentIds == null) return []
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 10) throw httpError(400, '附件数量无效，最多 10 个')
    const ids = [...new Set(attachmentIds.map(String))]
    const attachments = ids.map(id => this.db.getAttachment(id))
    const room = this.db.getRoomById(roomId)
    if (room && room.settings && room.settings.allowFileUpload === false && ids.length) throw httpError(403, '此聊天室已禁止上传附件')
    return attachments
  }

  _handleTyping(ws, { roomId, isTyping }) {
    if (!ws.userId || !ws.activeRooms.has(roomId)) return

    if (!this.typingStates.has(roomId)) this.typingStates.set(roomId, new Map())
    const rt = this.typingStates.get(roomId)

    if (isTyping) rt.set(ws.userId, Date.now())
    else rt.delete(ws.userId)

    this._broadcastToRoom(roomId, {
      type: 'typing',
      userId: ws.userId,
      roomId,
      isTyping
    }, ws.userId)
  }

  _handleRead(ws, { roomId, messageId }) {
    if (!ws.userId || !this.db.getMember(roomId, ws.userId)) return
    const message = this.db._getMessage(messageId)
    if (!message || message.room_id !== roomId) return
    this.db.markMessageRead(messageId, ws.userId)
    this._broadcastToRoom(roomId, { type: 'message_read', messageId, userId: ws.userId }, ws.userId)
  }

  _onDisconnect(ws) {
    if (!ws.userId) return
    console.log(`[Chatroom] 用户断线: ${ws.userId}`)

    const userClients = this.clients.get(ws.userId)
    if (userClients) {
      userClients.delete(ws)
      if (userClients.size === 0) {
        this.clients.delete(ws.userId)
        // 从所有活跃聊天室移除
        for (const roomId of ws.activeRooms) {
          this._removeFromRoom(ws.userId, roomId)
          this._broadcastToRoom(roomId, { type: 'user_offline', userId: ws.userId, roomId })
        }
      }
    }
  }

  _removeFromRoom(userId, roomId) {
    const presence = this.roomPresence.get(roomId)
    if (presence) {
      presence.delete(userId)
      if (presence.size === 0) this.roomPresence.delete(roomId)
    }
    const typing = this.typingStates.get(roomId)
    if (typing) typing.delete(userId)
  }

  _broadcastToRoom(roomId, message, excludeUserId = null) {
    const presence = this.roomPresence.get(roomId)
    if (!presence) return

    for (const userId of presence) {
      if (userId === excludeUserId) continue
      this.sendToUser(userId, message)
    }

    // 如果发送者也在房间里（例如 new_message 需要回执）
    if (excludeUserId === null) return
    // new_message 总是也要发给自己（作为确认/tempId 替换）
    if (message.type === 'new_message') {
      this.sendToUser(excludeUserId, message)
    }
  }

  sendToUser(userId, message) {
    const userClients = this.clients.get(userId)
    if (!userClients) return
    for (const ws of userClients) {
      if (ws.readyState === 1) this._send(ws, message)
    }
  }

  _send(ws, message) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(message))
    } catch (e) { /* ignore */ }
  }

  _checkAuth(ws) {
    if (ws.userId) return true
    this._send(ws, { type: 'error', error: '请先认证' })
    return false
  }

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now()

      this.wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate()
        ws.isAlive = false
        ws.ping()
      })

      // 清理超过 5 秒的输入状态
      for (const [roomId, rt] of this.typingStates) {
        for (const [userId, ts] of rt) {
          if (now - ts > 5000) {
            rt.delete(userId)
            this._broadcastToRoom(roomId, { type: 'typing', userId, roomId, isTyping: false })
          }
        }
      }
    }, 30_000)
  }

  getOnlineUsers(roomId) {
    return Array.from(this.roomPresence.get(roomId) || [])
  }

  stop() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer)
    this.wss?.close()
    console.log('[Chatroom] WebSocket 服务器已停止')
  }
}

// ===== 主插件入口 =====

export async function apply(ctx, config = {}) {
  const storage = new StorageManager({
    basePath: config.storagePath || StorageManager.defaultBasePath(),
    maxDiskUsageMB: config.maxDiskUsageMB || 1000
  })

  const db = new ChatroomDatabase(storage.dbPath)
  const wssServer = new ChatroomWSSServer(db)
  const wsTickets = new Map()
  const issueWsTicket = user => {
    const token = randomBytes(32).toString('base64url')
    wsTickets.set(token, { userId: user.userId, expires: Date.now() + 120_000 })
    if (wsTickets.size > 100) for (const [key, ticket] of wsTickets) if (ticket.expires < Date.now()) wsTickets.delete(key)
    return token
  }
  wssServer.authenticate = token => {
    const ticket = wsTickets.get(String(token || ''))
    if (!ticket || ticket.expires < Date.now()) return null
    wsTickets.delete(String(token))
    return ticket.userId
  }
  let wsPort = null

  // 插件带 inject 声明，apply 执行时宿主早已越过 'ready'，
  // 再等 ctx.on('ready') 永远不会触发 —— WS 必须在 apply 里直接启动。
  try {
    wsPort = await wssServer.start(config.wsPort || 0)
    console.log('[Chatroom] 插件已加载')
    console.log('[Chatroom] 存储路径:', storage.basePath)
    console.log('[Chatroom] WebSocket 端口:', wsPort)
  } catch (e) {
    console.error('[Chatroom] WebSocket 启动失败:', e && e.message)
  }

  // 本地身份兜底：DeepSeek 账号未登录（或登录不可用）时，
  // 用持久化的本地用户档案保证聊天室可用，昵称可在面板里改。
  const localUserPath = path.join(storage.basePath, 'local-user.json')
  let cachedUser = null
  let signedOut = false
  function readLocalUser() {
    try {
      const u = JSON.parse(fs.readFileSync(localUserPath, 'utf8'))
      if (u && u.userId) return u
    } catch {}
    const u = { userId: 'local-' + randomBytes(6).toString('hex'), username: '本地用户', avatar: null }
    try { fs.writeFileSync(localUserPath, JSON.stringify(u, null, 2)) } catch {}
    return u
  }

  function applyProfile(user) {
    if (!user) return user
    const profile = db.getProfile(user.userId)
    if (!profile) return user
    return {
      ...user,
      username: profile.nickname || user.username,
      avatarUrl: profile.avatarPath
        ? '/chatroom-api/avatar/' + encodeURIComponent(user.userId) + '?v=' + profile.updatedAt
        : user.avatarUrl || null
    }
  }

  async function getCurrentUser() {
    if (signedOut) return applyProfile(readLocalUser())
    const svc = ctx.deepseekAccount
    if (svc) {
      const state = typeof svc.getState === 'function' ? await svc.getState() : null
      const acct = state && (state.account || state.user || state.profile)
      const stateId = acct && (acct.userId || acct.id || acct.accountId || acct.uid)
      if (cachedUser && (!stateId || cachedUser.userId === String(stateId))) return cachedUser
      if (stateId) {
        cachedUser = applyProfile({
          userId: String(stateId),
          username: acct.username || acct.nickname || acct.name || acct.email || 'User',
          avatar: acct.avatarUrl || acct.avatar || null
        })
        return cachedUser
      }
      // 明确登出后才使用持久化本地身份，不因网络故障切换到另一个用户。
      if (state && state.status === 'signed-out') return applyProfile(readLocalUser())
      if (typeof svc.getProfile === 'function' && (!state || state.status === 'credential-stored')) {
        const client = {
          version: '0.9.95', locale: 'zh-CN',
          timezoneOffsetSeconds: new Date().getTimezoneOffset() * 60
        }
        const result = await svc.getProfile(client)
        const profile = result && (result.value || result)
        if (profile && profile.id) {
          cachedUser = applyProfile({
            userId: String(profile.id),
            username: profile.name || profile.contact || 'User',
            avatar: profile.avatarUrl || null
          })
          return cachedUser
        }
        if (!profile) return applyProfile(readLocalUser())
      }
      throw httpError(503, '账号信息暂时不可用，请稍后重试')
    }
    return applyProfile(readLocalUser())
  }

  const chatroomApi = {
    // WebSocket 端口（客户端连接用）
    getWsPort() { return wsPort },

    async createRoom(name, settings) {
      const user = await getCurrentUser()
      if (!user) throw new Error('未登录')

      const room = {
        id: generateId('room'),
        name,
        ownerId: user.userId,
        inviteCode: generateInviteCode(),
        createdAt: Date.now(),
        settings: { maxMembers: 100, isPublic: false, allowFileUpload: true, ...settings }
      }
      db.createRoom(room)

      db.addMember({ roomId: room.id, userId: user.userId, nickname: user.username, role: 'owner', joinedAt: Date.now() })

      console.log('[Chatroom] 聊天室已创建:', room.id, room.name)
      return room
    },

    async joinByInviteCode(code) {
      const user = await getCurrentUser()
      if (!user) throw new Error('未登录')

      const room = db.getRoomByInviteCode(code)
      if (!room) throw new Error('邀请码无效')
      if (room.inviteCodeExpiry && Date.now() > room.inviteCodeExpiry) throw new Error('邀请码已过期')

      if (db.getMember(room.id, user.userId)) return room

      db.addMember({ roomId: room.id, userId: user.userId, nickname: user.username, role: 'member', joinedAt: Date.now() })

      // 通知在线成员有新人加入
      wssServer.sendToUser(room.ownerId, {
        type: 'member_joined',
        roomId: room.id,
        userId: user.userId,
        nickname: user.username
      })

      console.log('[Chatroom] 用户加入聊天室:', user.userId, room.id)
      return room
    },

    async getMyRooms() {
      const user = await getCurrentUser()
      if (!user) return []
      return db.getUserRooms(user.userId)
    },

    async getRoomById(roomId) {
      const user = await getCurrentUser()
      if (!user) return null
      if (!db.getMember(roomId, user.userId)) throw new Error('无权限访问')
      return db.getRoomById(roomId)
    },

    async getRoomMembers(roomId) {
      const user = await getCurrentUser()
      if (!user) return []
      if (!db.getMember(roomId, user.userId)) throw new Error('无权限访问')
      return db.getRoomMembers(roomId)
    },

    async updateMyNickname(roomId, nickname) {
      const user = await getCurrentUser()
      if (!user) throw new Error('未登录')
      if (!db.getMember(roomId, user.userId)) throw new Error('不是聊天室成员')
      db.updateMemberNickname(roomId, user.userId, nickname)

      // 广播备注变更
      wssServer._broadcastToRoom(roomId, {
        type: 'nickname_changed',
        roomId,
        userId: user.userId,
        nickname
      })
    },

    async setMute(roomId, until) {
      const user = await getCurrentUser()
      if (!user) throw new Error('未登录')
      if (!db.getMember(roomId, user.userId)) throw new Error('不是聊天室成员')
      db.updateMemberMute(roomId, user.userId, until)
    },

    async uploadAttachment(roomId, data, options = {}) {
      const user = await getCurrentUser()
      if (!user) throw httpError(401, '未登录')
      const member = db.getMember(roomId, user.userId)
      if (!member) throw httpError(403, '不是聊天室成员，不能上传附件')
      const room = db.getRoomById(roomId)
      if (room && room.settings && room.settings.allowFileUpload === false) throw httpError(403, '此聊天室已禁止上传附件')
      const maxFileSizeMB = Math.min(100, Math.max(1, Number(config.maxFileSizeMB) || 20))
      if (!Buffer.isBuffer(data) || data.length === 0) throw httpError(400, '不能上传空文件')
      if (data.length > maxFileSizeMB * 1024 * 1024) throw httpError(413, `文件不能超过 ${maxFileSizeMB} MB`)
      const fileName = cleanFileName(options.fileName)
      const mimeType = resolveMimeType(options.mimeType, data)
      const attachment = {
        id: generateId('file'), messageId: null, fileName, fileSize: data.length, mimeType,
        localPath: null, uploadedBy: user.userId, uploadedAt: Date.now()
      }
      attachment.localPath = storage.getFilePath(roomId, attachment.id, fileName)
      await fs.promises.writeFile(attachment.localPath, data, { flag: 'wx' })
      try {
        db.addAttachment(attachment)
      } catch (error) {
        await fs.promises.unlink(attachment.localPath).catch(() => {})
        throw error
      }
      console.log(`[Chatroom] 附件已上传: ${attachment.id} (${fileName}, ${data.length} bytes)`)
      return publicAttachment(attachment)
    },

    async deleteAttachment(id) {
      const user = await getCurrentUser()
      const attachment = db.getAttachment(id)
      if (!attachment || !user || attachment.uploadedBy !== user.userId) throw httpError(403, '附件不存在或不属于当前用户')
      if (attachment.messageId) throw httpError(409, '已发送的附件不能撤回')
      db.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
      await fs.promises.unlink(attachment.localPath).catch(error => {
        if (error.code !== 'ENOENT') console.warn('[Chatroom] 清理未发送附件失败:', error.message)
      })
      return { ok: true }
    },

    async getAttachmentForDownload(id) {
      const user = await getCurrentUser()
      const attachment = db.getAttachment(id)
      if (!attachment || !user) throw httpError(404, '附件不存在')
      if (!attachment.messageId) {
        if (attachment.uploadedBy !== user.userId) throw httpError(403, '无权访问附件')
      } else {
        const message = db._getMessage(attachment.messageId)
        if (!message) throw httpError(404, '附件所属消息不存在')
        if (!db.getMember(message.room_id, user.userId)) throw httpError(403, '不是聊天室成员，无权访问附件')
      }
      const stat = await fs.promises.stat(attachment.localPath)
      if (stat.size !== attachment.fileSize) throw httpError(404, '附件内容不完整，请联系发送者重新上传')
      return attachment
    },

    async sendMessage(roomId, content, attachmentIds = [], options = {}) {
      const user = await getCurrentUser()
      if (!user) throw new Error('未登录')

      const member = db.getMember(roomId, user.userId)
      if (!member) throw new Error('不是聊天室成员')

      const text = String(content || '').trim().slice(0, 20000)
      const attachments = wssServer._resolveAttachments(roomId, user.userId, attachmentIds)
      const result = db.createAttachmentMessage(roomId, text, attachments, user, member,
        options.messageId, options.tempId, attachmentIds || [])
      if (!result.duplicate) wssServer._broadcastToRoom(roomId, { type: 'new_message', roomId, ...result })
      return result.message
    },

    async getMessages(roomId, limit = 50, before) {
      const user = await getCurrentUser()
      if (!user) return []
      if (!db.getMember(roomId, user.userId)) throw new Error('无权限访问')
      return db.getMessages(roomId, limit, before)
    },

    async refreshInviteCode(roomId, expiryHours) {
      const user = await getCurrentUser()
      if (!user) throw new Error('未登录')
      const room = db.getRoomById(roomId)
      if (!room) throw new Error('聊天室不存在')
      if (room.ownerId !== user.userId) throw new Error('只有创建者可以刷新邀请码')

      const newCode = generateInviteCode()
      db.updateInviteCode(roomId, newCode, expiryHours ? Date.now() + expiryHours * 3_600_000 : undefined)
      return newCode
    },

    async updateMyProfile(nickname) {
      const user = await getCurrentUser()
      if (!user) throw httpError(401, '未登录')
      const name = String(nickname ?? '').trim().slice(0, 30)
      if (!name) throw httpError(400, '昵称不能为空')
      db.upsertProfile({ userId: user.userId, nickname: name })
      // 昵称对所有已加入的聊天室生效，并实时通知各房间
      for (const room of db.getUserRooms(user.userId)) {
        db.updateMemberNickname(room.id, user.userId, name)
        wssServer._broadcastToRoom(room.id, {
          type: 'nickname_changed', roomId: room.id, userId: user.userId, nickname: name
        })
      }
      cachedUser = applyProfile({ ...user, username: name })
      return cachedUser
    },

    async uploadAvatar(data, declaredType) {
      const user = await getCurrentUser()
      if (!user) throw httpError(401, '未登录')
      if (!Buffer.isBuffer(data) || data.length === 0) throw httpError(400, '不能上传空文件')
      if (data.length > 5 * 1024 * 1024) throw httpError(413, '头像不能超过 5 MB')
      const mimeType = resolveMimeType(declaredType, data)
      if (!mimeType.startsWith('image/')) throw httpError(415, '头像仅支持 PNG、JPEG、WebP、GIF')
      const old = db.getProfile(user.userId)
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mimeType] || '.img'
      const dir = path.join(storage.filesDir, 'avatars')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, cleanFileName(user.userId) + ext)
      await fs.promises.writeFile(filePath, data)
      db.upsertProfile({ userId: user.userId, avatarPath: filePath, avatarMime: mimeType })
      if (old && old.avatarPath && old.avatarPath !== filePath) {
        await fs.promises.unlink(old.avatarPath).catch(() => {})
      }
      cachedUser = applyProfile({ ...user })
      const avatarUrl = cachedUser.avatarUrl
      for (const room of db.getUserRooms(user.userId)) {
        wssServer._broadcastToRoom(room.id, {
          type: 'profile_changed', roomId: room.id, userId: user.userId, avatarUrl
        })
      }
      console.log('[Chatroom] 头像已更新:', user.userId, mimeType, data.length, 'bytes')
      return { avatarUrl }
    },

    async getAvatarForDownload(userId) {
      const user = await getCurrentUser()
      if (!user) throw httpError(401, '未登录')
      const profile = db.getProfile(userId)
      if (!profile || !profile.avatarPath) throw httpError(404, '头像不存在')
      const stat = await fs.promises.stat(profile.avatarPath)
      return { localPath: profile.avatarPath, mimeType: profile.avatarMime || 'image/png', fileSize: stat.size }
    },

    getOnlineUsers(roomId) {
      return wssServer.getOnlineUsers(roomId)
    },

    async getStorageInfo() {
      const user = await getCurrentUser()
      if (!user) throw httpError(401, '未登录')
      return {
        basePath: storage.basePath,
        dbPath: storage.dbPath,
        wsPort,
        wsToken: issueWsTicket(user)
      }
    }
  }
  ctx.provide('chatroom', chatroomApi)

  // ===== Web 客户端 HTTP API（浏览器通过同源 fetch 调用）=====
  const readBody = async (req) => {
    const data = await readRequestBody(req, 1024 * 1024)
    try { return JSON.parse(data.toString('utf8') || '{}') }
    catch { throw httpError(400, '请求 JSON 格式无效') }
  }
  const jsonResponse = (res, status, obj) => {
    if (res.writableEnded) return
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(obj))
  }
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/chatroom-api',
      handler: async (req, res) => {
        try {
          const origin = req.headers.origin
          if (origin && new URL(origin).host !== req.headers.host) throw httpError(403, '仅允许同源访问 Chatroom')
          if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, '仅允许同源访问 Chatroom')
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          const sub = url.pathname.replace(/^\/chatroom-api/, '') || '/'
          const method = req.method || 'GET'
          if (method === 'GET' && sub === '/profile') {
            const user = await getCurrentUser()
            return jsonResponse(res, 200, { user })
          }
          if (method === 'POST' && sub === '/profile') {
            const body = await readBody(req)
            return jsonResponse(res, 200, { user: await chatroomApi.updateMyProfile(body.nickname) })
          }
          if (method === 'POST' && sub === '/profile/avatar') {
            const data = await readRequestBody(req, 6 * 1024 * 1024)
            return jsonResponse(res, 200, await chatroomApi.uploadAvatar(data,
              url.searchParams.get('type') || req.headers['content-type']))
          }
          if (method === 'GET' && sub === '/rooms') {
            return jsonResponse(res, 200, await chatroomApi.getMyRooms())
          }
          if (method === 'GET' && sub === '/storage-info') {
            return jsonResponse(res, 200, await chatroomApi.getStorageInfo())
          }
          if (method === 'POST' && sub === '/rooms') {
            const body = await readBody(req)
            return jsonResponse(res, 200, await chatroomApi.createRoom(body.name, body.settings))
          }
          if (method === 'POST' && sub === '/join') {
            const body = await readBody(req)
            return jsonResponse(res, 200, await chatroomApi.joinByInviteCode(body.code))
          }
          // 与 DSH 原生文件上传一致，使用 application/octet-stream 传递原始字节。
          let m = sub.match(/^\/avatar\/([^/]+)$/)
          if (m && method === 'GET') {
            const avatar = await chatroomApi.getAvatarForDownload(decodeURIComponent(m[1]))
            res.writeHead(200, {
              'Content-Type': avatar.mimeType,
              'Content-Length': avatar.fileSize,
              'Content-Disposition': contentDisposition('inline', 'avatar'),
              'Cache-Control': 'no-cache',
              'X-Content-Type-Options': 'nosniff'
            })
            const stream = fs.createReadStream(avatar.localPath)
            stream.on('error', () => res.destroy())
            stream.pipe(res)
            return
          }
          m = sub.match(/^\/rooms\/([^/]+)\/attachments$/)
          if (m && method === 'POST') {
            const roomId = decodeURIComponent(m[1])
            const maxBytes = Math.min(100, Math.max(1, Number(config.maxFileSizeMB) || 20)) * 1024 * 1024
            const data = await readRequestBody(req, maxBytes)
            return jsonResponse(res, 201, await chatroomApi.uploadAttachment(roomId, data, {
              fileName: url.searchParams.get('name') || '未命名文件',
              mimeType: url.searchParams.get('type') || req.headers['content-type']
            }))
          }
          m = sub.match(/^\/attachments\/([^/]+)$/)
          if (m && (method === 'GET' || method === 'HEAD')) {
            const file = await chatroomApi.getAttachmentForDownload(decodeURIComponent(m[1]))
            const inline = url.searchParams.get('download') !== '1' && file.mimeType.startsWith('image/')
            res.writeHead(200, {
              'Content-Type': file.mimeType,
              'Content-Length': file.fileSize,
              'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.fileName),
              'Cache-Control': 'private, max-age=31536000, immutable',
              'X-Content-Type-Options': 'nosniff'
            })
            if (method === 'HEAD') return res.end()
            const stream = fs.createReadStream(file.localPath)
            stream.on('error', () => res.destroy())
            stream.pipe(res)
            return
          }
          if (m && method === 'DELETE') {
            return jsonResponse(res, 200, await chatroomApi.deleteAttachment(decodeURIComponent(m[1])))
          }
          m = sub.match(/^\/rooms\/([^/]+)\/messages$/)
          if (m && method === 'GET') {
            return jsonResponse(res, 200, await chatroomApi.getMessages(m[1], Number(url.searchParams.get('limit')) || 50, url.searchParams.get('before') || undefined))
          }
          if (m && method === 'POST') {
            const body = await readBody(req)
            return jsonResponse(res, 200, await chatroomApi.sendMessage(m[1], body.content, body.attachmentIds, {
              messageId: body.messageId, tempId: body.tempId
            }))
          }
          m = sub.match(/^\/rooms\/([^/]+)\/members$/)
          if (m && method === 'GET') {
            return jsonResponse(res, 200, await chatroomApi.getRoomMembers(m[1]))
          }
          m = sub.match(/^\/rooms\/([^/]+)\/nickname$/)
          if (m && method === 'POST') {
            const body = await readBody(req)
            return jsonResponse(res, 200, await chatroomApi.updateMyNickname(m[1], body.nickname))
          }
          m = sub.match(/^\/rooms\/([^/]+)\/invite\/refresh$/)
          if (m && method === 'POST') {
            const body = await readBody(req)
            return jsonResponse(res, 200, { code: await chatroomApi.refreshInviteCode(m[1], body.expiryHours) })
          }
          jsonResponse(res, 404, { error: 'not found' })
        } catch (e) {
          const status = Number(e && e.status) || (e && e.code === 'ENOENT' ? 404 : 500)
          if (status >= 500) console.error('[Chatroom] API error:', e && e.stack || e)
          jsonResponse(res, status, { error: String(e && e.message || e) })
        }
      }
    }), 'chatroom: api route')
  })

  ctx.on('deepseek-account/signed-out', () => {
    if (cachedUser && !cachedUser.userId.startsWith('local-')) signedOut = true
    cachedUser = null
    for (const ws of wssServer.wss?.clients || []) ws.close(1008, 'Signed out')
    console.log('[Chatroom] 用户已登出')
  })

  ctx.on('dispose', () => {
    wssServer.stop()
    db.close()
    console.log('[Chatroom] 插件已卸载')
  })
}

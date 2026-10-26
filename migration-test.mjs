// 构造旧版附件表，验证真实迁移分支与异步 DSH 账号接口。仅使用临时数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { apply } from './lib/index.js'

const temporary = fs.mkdtempSync(path.join(process.env.CHATROOM_TEST_TMP || os.tmpdir(), 'chatroom-migration-'))
const databasePath = path.join(temporary, 'chatroom.db')
const filePath = path.join(temporary, 'legacy-image.png')
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
fs.writeFileSync(filePath, bytes)
const db = new Database(databasePath)
db.exec(`
  CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
    invite_code TEXT UNIQUE, invite_code_expiry INTEGER, settings TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE members (room_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER NOT NULL, muted_until INTEGER, PRIMARY KEY (room_id, user_id));
  CREATE TABLE messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text',
    timestamp INTEGER NOT NULL, read_by TEXT NOT NULL DEFAULT '[]');
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL, local_path TEXT NOT NULL, thumbnail_path TEXT,
    uploaded_by TEXT NOT NULL, uploaded_at INTEGER NOT NULL
  );
  INSERT INTO rooms VALUES ('legacy-room', '旧聊天室', 'account-1', 'ABC123', NULL, '{"maxMembers":100}', 1);
  INSERT INTO members VALUES ('legacy-room', 'account-1', '旧用户', 'owner', 1, NULL);
  INSERT INTO messages VALUES ('legacy-message', 'legacy-room', 'account-1', '旧用户', '历史图片', 'image', 2, '[]');
`)
db.prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-file', 'legacy-message', '历史图片.png', bytes.length, 'image/png', filePath, null, 'account-1', 3)
db.close()

let profileReads = 0
let unavailable = false
const disposers = []
const handlers = new Map()
const ctx = {
  deepseekAccount: {
    async getState() { return { status: 'credential-stored', attempt: null, links: {} } },
    async getProfile() {
      profileReads++
      if (unavailable) throw new Error('模拟网络中断')
      return { status: 'ready', value: { id: 'account-1', name: '账号用户' } }
    }
  },
  provide(name, value) { this[name] = value },
  inject(_dependencies, callback) { callback(this) },
  effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) },
  on(event, callback) { handlers.set(event, callback); if (event === 'dispose') disposers.push(callback) },
  webServer: { register() { return () => {} } }
}
try {
  await apply(ctx, { storagePath: temporary, wsPort: 0 })
  const rooms = await ctx.chatroom.getMyRooms()
  assert.equal(rooms.length, 1)
  assert.equal(rooms[0].name, '旧聊天室')
  assert.equal(profileReads, 1)
  const roomsAgain = await ctx.chatroom.getMyRooms()
  assert.equal(roomsAgain[0].id, 'legacy-room')
  assert.equal(profileReads, 1, '已成功读取的账号应复用，不能每次请求远端')
  unavailable = true
  assert.equal((await ctx.chatroom.getMyRooms())[0].id, 'legacy-room')
  console.log('  ✓ 异步账号接口正常，远端不可用时保持原账号身份')

  const messages = await ctx.chatroom.getMessages('legacy-room')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].attachments[0].id, 'legacy-file')
  assert.equal(messages[0].attachments[0].localPath, undefined)
  const file = await ctx.chatroom.getAttachmentForDownload('legacy-file')
  assert.ok(fs.readFileSync(file.localPath).equals(bytes))
  console.log('  ✓ 历史消息和附件在迁移后保留，文件字节一致')

  const sqlite = new Database(databasePath, { readonly: true })
  const columns = sqlite.prepare('PRAGMA table_info(attachments)').all()
  const legacy = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attachments_legacy'").get()
  sqlite.close()
  assert.ok(columns.some(column => column.name === 'position'))
  assert.equal(columns.find(column => column.name === 'message_id').notnull, 0)
  assert.equal(legacy, undefined)
  console.log('  ✓ 旧表迁移为可暂存附件结构，排序字段和临时表清理正确')
  console.log('旧数据库迁移与异步账号测试通过：3 项')
} finally {
  for (const dispose of disposers.reverse()) { try { await dispose() } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true })
}

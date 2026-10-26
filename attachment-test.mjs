// Chatroom 附件功能独立回归测试。使用临时目录和独立 WebSocket，不访问真实聊天室。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import WebSocket from 'ws'
import { apply } from './lib/index.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const temporary = fs.mkdtempSync(path.join(process.env.CHATROOM_TEST_TMP || os.tmpdir(), 'chatroom-attachments-'))
let activeUser = { userId: 'user-a', username: 'Alice' }
let route
let passed = 0
const disposers = []
const ctx = {
  deepseekAccount: { getState: () => ({ account: { id: activeUser.userId, name: activeUser.username } }) },
  provide(name, service) { this[name] = service },
  inject(_dependencies, callback) { callback(this) },
  effect(disposer) { const result = disposer(); if (typeof result === 'function') disposers.push(result); return result },
  on(event, callback) { if (event === 'dispose') disposers.push(callback) },
  webServer: { register(value) { route = value; return () => {} } }
}

class Response extends Writable {
  constructor() { super(); this.chunks = []; this.headers = {}; this.statusCode = 0; this._write = (chunk, _encoding, done) => { this.chunks.push(Buffer.from(chunk)); done() } }
  writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; return this }
  json() { return JSON.parse(Buffer.concat(this.chunks).toString('utf8')) }
}

async function request(method, url, body, contentType) {
  const req = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : JSON.stringify(body)])
  req.method = method
  req.url = url
  req.headers = { ...(contentType ? { 'content-type': contentType } : {}), ...(body?.length ? { 'content-length': String(body.length) } : {}) }
  const res = new Response()
  await route.handler(req, res)
  await finished(res)
  return res
}

const json = (method, url, body) => request(method, '/chatroom-api' + url, body, 'application/json')
const upload = (roomId, name, data, type = 'application/octet-stream') => request('POST', '/chatroom-api/rooms/' + encodeURIComponent(roomId) + '/attachments?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), data, 'application/octet-stream')
const expectStatus = (response, status) => {
  if (response.statusCode === status) return
  const text = Buffer.concat(response.chunks).toString('utf8')
  let detail = text
  try { detail = JSON.stringify(JSON.parse(text)) } catch {}
  assert.equal(response.statusCode, status, detail.slice(0, 300))
}
async function check(name, task) { await task(); passed++; console.log('  ✓ ' + name) }
async function waitFor(messages, type, timeout = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const index = messages.findIndex(message => message.type === type)
    if (index >= 0) return messages.splice(index, 1)[0]
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw new Error('等待 WebSocket ' + type + ' 超时')
}

try {
  await apply(ctx, { storagePath: temporary, maxFileSizeMB: 1, wsPort: 0 })
  assert.ok(route)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const textBytes = Buffer.from('Chatroom 文件内容\n第二行', 'utf8')
  const roomResponse = await json('POST', '/rooms', { name: '附件回归测试' })
  expectStatus(roomResponse, 200)
  const room = roomResponse.json()

  await check('创建临时聊天室', async () => assert.equal(room.name, '附件回归测试'))
  const imageResponse = await upload(room.id, '../../测试 图片.png', png, 'text/plain')
  expectStatus(imageResponse, 201)
  const image = imageResponse.json()
  await check('保存图片并从字节识别 MIME，清理文件名路径', async () => {
    assert.equal(image.fileName, '测试 图片.png')
    assert.equal(image.mimeType, 'image/png')
    assert.equal(image.fileSize, png.length)
    assert.ok(image.url.startsWith('/chatroom-api/attachments/'))
    assert.equal(image.localPath, undefined)
    assert.equal(image.uploadedBy, undefined)
  })

  activeUser = { userId: 'user-b', username: 'Bob' }
  expectStatus(await upload(room.id, 'denied.txt', textBytes, 'text/plain'), 403)
  expectStatus(await request('GET', image.url), 403)
  await check('非成员不能上传或读取未发送附件', async () => {})
  expectStatus(await json('POST', '/join', { code: room.inviteCode }), 200)
  const genericResponse = await upload(room.id, '说明文档.txt', textBytes, 'text/plain')
  expectStatus(genericResponse, 201)
  const generic = genericResponse.json()
  await check('普通文件上传并保留文件类型', async () => assert.equal(generic.mimeType, 'text/plain'))

  const empty = await upload(room.id, 'empty.txt', Buffer.alloc(0), 'text/plain')
  expectStatus(empty, 400)
  const large = await upload(room.id, 'large.bin', Buffer.alloc(1024 * 1024 + 1))
  expectStatus(large, 413)
  const fakeImage = await upload(room.id, 'fake.png', textBytes, 'image/png')
  expectStatus(fakeImage, 415)
  await check('空文件、超限文件、伪造图片均被拒绝', async () => {})

  activeUser = { userId: 'user-a', username: 'Alice' }
  const secondImageResponse = await upload(room.id, '第二图.gif', Buffer.from('GIF89a' + 'test-image-content'), 'image/gif')
  expectStatus(secondImageResponse, 201)
  const secondImage = secondImageResponse.json()
  const messageId = 'msg-0123456789abcdef0123456789abcdef'
  const sent = await json('POST', '/rooms/' + room.id + '/messages', { content: '图片与说明', attachmentIds: [secondImage.id, image.id], messageId })
  expectStatus(sent, 200)
  const message = sent.json()
  await check('发送图文消息并按选择顺序绑定附件', async () => {
    assert.equal(message.id, messageId)
    assert.equal(message.type, 'image')
    assert.deepEqual(message.attachments.map(file => file.id), [secondImage.id, image.id])
    assert.equal(message.attachments[0].messageId, messageId)
    assert.equal(message.localPath, undefined)
  })

  const duplicate = await json('POST', '/rooms/' + room.id + '/messages', { content: '图片与说明', attachmentIds: [secondImage.id, image.id], messageId })
  expectStatus(duplicate, 200)
  const changed = await json('POST', '/rooms/' + room.id + '/messages', { content: '不同内容', attachmentIds: [secondImage.id, image.id], messageId })
  expectStatus(changed, 409)
  await check('幂等重试不重复发消息，冲突消息 ID 被拒绝', async () => {
    assert.deepEqual(duplicate.json(), message)
    expectStatus(await json('GET', '/rooms/' + room.id + '/messages?limit=50'), 200)
    const messages = (await json('GET', '/rooms/' + room.id + '/messages?limit=50')).json()
    assert.equal(messages.length, 1)
  })

  expectStatus(await request('DELETE', image.url), 409)
  await check('已发送附件不能作为草稿删除', async () => {})
  activeUser = { userId: 'user-b', username: 'Bob' }
  const history = (await json('GET', '/rooms/' + room.id + '/messages?limit=50')).json()
  await check('成员历史消息包含附件元数据但不暴露磁盘路径', async () => {
    assert.equal(history[0].attachments.length, 2)
    assert.equal(JSON.stringify(history).includes(temporary), false)
  })
  const downloadedImage = await request('GET', image.url)
  expectStatus(downloadedImage, 200)
  const downloadedFile = await request('GET', generic.url + '?download=1')
  expectStatus(downloadedFile, 200)
  await check('成员读取图片字节一致，普通文件下载字节一致', async () => {
    assert.ok(Buffer.concat(downloadedImage.chunks).equals(png))
    assert.ok(Buffer.concat(downloadedFile.chunks).equals(textBytes))
    assert.match(downloadedImage.headers['Content-Disposition'], /^inline;/)
    assert.match(downloadedFile.headers['Content-Disposition'], /^attachment;/)
    assert.equal(downloadedImage.headers['X-Content-Type-Options'], 'nosniff')
  })
  expectStatus(await json('POST', '/rooms/' + room.id + '/messages', { content: '盗用附件', attachmentIds: [image.id] }), 403)
  await check('不能使用其他用户上传的附件', async () => {})

  const ownPendingResponse = await upload(room.id, '待删除.txt', textBytes, 'text/plain')
  const ownPending = ownPendingResponse.json()
  activeUser = { userId: 'user-a', username: 'Alice' }
  expectStatus(await request('DELETE', ownPending.url), 403)
  activeUser = { userId: 'user-b', username: 'Bob' }
  expectStatus(await request('DELETE', ownPending.url), 200)
  expectStatus(await request('GET', ownPending.url), 404)
  await check('仅上传者可删除未发送附件，删除后不可读取', async () => {})
  const onlyFile = await json('POST', '/rooms/' + room.id + '/messages', { content: '', attachmentIds: [generic.id], messageId: 'msg-abcdefabcdefabcdefabcdefabcdefab' })
  expectStatus(onlyFile, 200)
  await check('支持不带文字的纯文件消息', async () => assert.equal(onlyFile.json().type, 'file'))
  expectStatus(await json('POST', '/rooms/' + room.id + '/messages', { content: '重复附件', attachmentIds: [generic.id] }), 409)
  await check('已发送附件不能再次绑定', async () => {})
  expectStatus(await json('POST', '/rooms/' + room.id + '/messages', { content: '', attachmentIds: [] }), 400)
  await check('空消息被拒绝', async () => {})

  const ws = new WebSocket('ws://127.0.0.1:' + ctx.chatroom.getWsPort())
  const events = []
  ws.on('message', data => events.push(JSON.parse(data.toString())))
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const connection = await json('GET', '/storage-info')
  expectStatus(connection, 200)
  assert.ok(connection.json().wsToken)
  ws.send(JSON.stringify({ type: 'auth', token: connection.json().wsToken }))
  await waitFor(events, 'auth_ok')
  ws.send(JSON.stringify({ type: 'join_room', roomId: room.id }))
  await waitFor(events, 'room_joined')
  const wsUpload = (await upload(room.id, '实时文件.txt', textBytes, 'text/plain')).json()
  ws.send(JSON.stringify({ type: 'send_message', roomId: room.id, content: 'WS 附件', attachmentIds: [wsUpload.id], tempId: 'tmp-attachment-test' }))
  const broadcast = await waitFor(events, 'new_message')
  await check('WebSocket 广播包含房间、附件和临时消息回执', async () => {
    assert.equal(broadcast.roomId, room.id)
    assert.equal(broadcast.tempId, 'tmp-attachment-test')
    assert.equal(broadcast.message.attachments[0].fileName, '实时文件.txt')
    assert.equal(broadcast.message.localPath, undefined)
  })
  ws.close()

  const sqlite = (await import('better-sqlite3')).default
  const database = new sqlite(path.join(temporary, 'chatroom.db'), { readonly: true })
  const columns = database.prepare('PRAGMA table_info(attachments)').all()
  const storedMessages = database.prepare('SELECT COUNT(*) AS count FROM messages').get().count
  database.close()
  await check('附件表及排序字段迁移成功，消息数量正确', async () => {
    assert.ok(columns.some(column => column.name === 'position'))
    assert.equal(storedMessages, 3)
  })
  console.log(`\n附件回归测试通过：${passed} 项`)
} finally {
  for (const dispose of disposers.reverse()) { try { await dispose() } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true })
}

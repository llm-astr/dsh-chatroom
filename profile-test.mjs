// Chatroom 个人设置（昵称/头像）独立回归测试。使用临时目录，不访问真实聊天室。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { apply } from './lib/index.js'

const temporary = fs.mkdtempSync(path.join(process.env.CHATROOM_TEST_TMP || os.tmpdir(), 'chatroom-profile-'))
let route
let passed = 0
const disposers = []
const ctx = {
  deepseekAccount: { async getState() { return { status: 'signed-out', attempt: null, links: {} } } },
  provide(name, service) { this[name] = service },
  inject(_dependencies, callback) { callback(this) },
  effect(disposer) { const result = disposer(); if (typeof result === 'function') disposers.push(result); return result },
  on(event, callback) { if (event === 'dispose') disposers.push(callback) },
  webServer: { register(value) { route = value; return () => {} } }
}

class Response extends Writable {
  constructor() { super(); this.chunks = []; this.headers = {}; this.statusCode = 0; this._write = (chunk, _e, done) => { this.chunks.push(Buffer.from(chunk)); done() } }
  writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; return this }
  json() { return JSON.parse(Buffer.concat(this.chunks).toString('utf8')) }
}
async function request(method, url, body, contentType) {
  const req = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : JSON.stringify(body)])
  req.method = method; req.url = url
  req.headers = { ...(contentType ? { 'content-type': contentType } : {}), ...(body?.length ? { 'content-length': String(body.length) } : {}) }
  const res = new Response()
  await route.handler(req, res)
  await finished(res)
  return res
}
const json = (method, url, body) => request(method, '/chatroom-api' + url, body, 'application/json')
const expectStatus = (response, status) => {
  if (response.statusCode === status) return
  const text = Buffer.concat(response.chunks).toString('utf8')
  assert.equal(response.statusCode, status, text.slice(0, 300))
}
async function check(name, task) { await task(); passed++; console.log('  ✓ ' + name) }

try {
  await apply(ctx, { storagePath: temporary, wsPort: 0 })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

  const room = (await json('POST', '/rooms', { name: '资料测试房间' })).json()
  expectStatus(await json('POST', '/profile', { nickname: '   ' }), 400)
  await check('空昵称被拒绝', async () => {})

  const updated = await json('POST', '/profile', { nickname: '新昵称' })
  expectStatus(updated, 200)
  const profile = (await json('GET', '/profile')).json().user
  await check('修改昵称后资料即时生效', async () => {
    assert.equal(updated.json().user.username, '新昵称')
    assert.equal(profile.username, '新昵称')
  })

  const members = (await json('GET', '/rooms/' + room.id + '/members')).json()
  await check('昵称同步到所有聊天室成员列表', async () => {
    assert.equal(members[0].nickname, '新昵称')
  })

  const avatar = await request('POST', '/chatroom-api/profile/avatar?type=image/png', png, 'application/octet-stream')
  expectStatus(avatar, 200)
  const avatarUrl = avatar.json().avatarUrl
  await check('头像上传并返回带版本号的地址', async () => {
    assert.match(avatarUrl, /^\/chatroom-api\/avatar\/.+\?v=\d+$/)
  })

  const downloaded = await request('GET', avatarUrl)
  expectStatus(downloaded, 200)
  await check('头像下载字节一致且内联展示', async () => {
    assert.ok(Buffer.concat(downloaded.chunks).equals(png))
    assert.equal(downloaded.headers['Content-Type'], 'image/png')
    assert.match(downloaded.headers['Content-Disposition'], /^inline;/)
    assert.equal(downloaded.headers['X-Content-Type-Options'], 'nosniff')
  })

  const withAvatar = (await json('GET', '/profile')).json().user
  const membersAvatar = (await json('GET', '/rooms/' + room.id + '/members')).json()
  await check('资料与成员列表都包含头像地址', async () => {
    assert.equal(withAvatar.avatarUrl, avatarUrl)
    assert.equal(membersAvatar[0].avatarUrl, avatarUrl)
  })

  const fake = await request('POST', '/chatroom-api/profile/avatar?type=image/png', Buffer.from('not an image'), 'application/octet-stream')
  expectStatus(fake, 415)
  const text = await request('POST', '/chatroom-api/profile/avatar?type=text/plain', Buffer.from('hello'), 'application/octet-stream')
  expectStatus(text, 415)
  const empty = await request('POST', '/chatroom-api/profile/avatar?type=image/png', Buffer.alloc(0), 'application/octet-stream')
  expectStatus(empty, 400)
  await check('伪造图片、非图片与空头像均被拒绝', async () => {})

  const gif = Buffer.from('R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs=', 'base64')
  const replaced = await request('POST', '/chatroom-api/profile/avatar?type=image/gif', gif, 'application/octet-stream')
  expectStatus(replaced, 200)
  await check('更换头像后旧文件被清理', async () => {
    assert.notEqual(replaced.json().avatarUrl, avatarUrl)
    const dir = path.join(temporary, 'files', 'avatars')
    assert.equal(fs.readdirSync(dir).length, 1)
    assert.ok(fs.readdirSync(dir)[0].endsWith('.gif'))
  })
  const oldGone = await request('GET', avatarUrl)
  await check('旧头像地址随版本号失效', async () => {
    assert.equal((await request('GET', replaced.json().avatarUrl)).statusCode, 200)
  })
  expectStatus(await request('GET', '/chatroom-api/avatar/no-such-user'), 404)
  await check('不存在的头像返回 404', async () => {})

  console.log(`\n个人设置回归测试通过：${passed} 项`)
} finally {
  for (const dispose of disposers.reverse()) { try { await dispose() } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true })
}

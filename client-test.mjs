// 使用 DSH 已安装的 React 验证插件浏览器产物，不需要额外安装测试依赖。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dshRoot = process.env.DSH_PLUGIN_HOST_ROOT || 'H:/DrawHimeClone/DrawHime Clone'
const modules = path.join(dshRoot, 'data', 'dsh-home', 'profiles', 'web', 'node_modules', '.pnpm')
const React = createRequire(path.join(modules, 'react@18.3.1', 'node_modules', 'react', 'index.js'))('react')
const renderToStaticMarkup = createRequire(path.join(modules, 'react-dom@18.3.1_react@18.3.1', 'node_modules', 'react-dom', 'server.node.js'))('react-dom/server').renderToStaticMarkup
const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8').replace('    return {\n      inject:', '    globalThis.__chatroomTestComponents = { DraftAttachments, MessageAttachments, HistoryImage, ImagePreview, ChatView, uploadAttachment };\n    return {\n      inject:')
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, DOMException, AbortController }
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.__ModuleLoader__ = { load(registration) { registration.factory(name => { assert.equal(name, 'react'); return React }) } }
vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
const components = sandbox.__chatroomTestComponents
assert.ok(components)

const imageDraft = { id: 'image-1', kind: 'image', file: { name: '示例图片.png', size: 100 }, previewUrl: 'blob:test-image', status: 'ready', progress: 1, attachment: null }
const fileDraft = { id: 'file-1', kind: 'file', file: { name: '使用说明.txt', size: 2048 }, previewUrl: null, status: 'uploading', progress: .45, attachment: null }
const drafts = renderToStaticMarkup(React.createElement(components.DraftAttachments, { drafts: [imageDraft, fileDraft], onRemove() {}, onRetry() {}, disabled: false }))
assert.match(drafts, /blob:test-image/)
assert.match(drafts, /示例图片.png/)
assert.match(drafts, /使用说明.txt/)
assert.match(drafts, /上传中 45%/)
assert.match(drafts, /移除 示例图片.png/)
console.log('  ✓ 图片缩略图、文件卡片、上传进度和移除按钮可渲染')

const attachment = { id: 'file-1', fileName: '使用说明.txt', fileSize: 2048, mimeType: 'text/plain', url: '/chatroom-api/attachments/file-1' }
const image = { id: 'image-1', fileName: '示例图片.png', fileSize: 100, mimeType: 'image/png', url: '/chatroom-api/attachments/image-1' }
const history = renderToStaticMarkup(React.createElement(components.MessageAttachments, { attachments: [image, attachment] }))
assert.match(history, /chatroom-api\/attachments\/image-1/)
assert.match(history, /chatroom-api\/attachments\/file-1\?download=1/)
assert.match(history, /点击下载/)
assert.match(history, /2.0 KB/)
console.log('  ✓ 历史图片预览入口和普通文件下载链接可渲染')

const preview = renderToStaticMarkup(React.createElement(components.ImagePreview, { src: image.url, name: image.fileName, onClose() {} }))
assert.match(preview, /role="dialog"/)
assert.match(preview, /aria-modal="true"/)
assert.match(preview, /关闭图片预览/)
console.log('  ✓ 图片灯箱具有关闭按钮和对话框语义')

const room = { id: 'room-test', name: '测试聊天室' }
const composer = renderToStaticMarkup(React.createElement(components.ChatView, { ctx: {}, room, user: { userId: 'user-1', username: '测试用户' }, ws: null, wsStatus: 'connected', onBack() {} }))
assert.match(composer, /type="file"/)
assert.match(composer, /multiple=""/)
assert.match(composer, /添加图片或文件/)
assert.match(composer, /onPaste|发送消息，可粘贴图片或拖入文件/)
assert.match(composer, /单文件最大 20 MB/)
console.log('  ✓ 多选文件输入、附件入口、粘贴/拖放提示与发送按钮可渲染')

let lastXhr
class FakeXHR {
  constructor() { lastXhr = this; this.upload = {}; this.headers = {}; this.status = 201; this.response = { id: 'file-test', url: '/chatroom-api/attachments/file-test' } }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(name, value) { this.headers[name] = value }
  send(body) { this.body = body; this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 }); this.onload() }
}
sandbox.XMLHttpRequest = FakeXHR
const progress = []
const result = await components.uploadAttachment('room-test', { name: '中文 图片.png', type: 'image/png', size: 10 }, null, value => progress.push(value), undefined)
assert.equal(result.id, 'file-test')
assert.deepEqual(progress, [.5])
assert.equal(lastXhr.method, 'POST')
assert.match(lastXhr.url, /name=%E4%B8%AD%E6%96%87(?:\+|%20)%E5%9B%BE%E7%89%87.png/)
assert.match(lastXhr.url, /type=image%2Fpng/)
assert.equal(lastXhr.headers['Content-Type'], 'application/octet-stream')
assert.equal(lastXhr.body.name, '中文 图片.png')
assert.equal(progress.length, 1)
console.log('  ✓ 浏览器二进制上传返回附件 ID 并报告真实进度')
console.log('客户端 React 渲染与上传测试通过：5 项')

import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocketServer } from 'ws'

// 用协议端替身隔离云崽运行环境，执行真实转换函数和真实 WebSocket Client。
async function fixture() {
  const mappings = new Map(), sent = []
  const original = { message_id: 'native-9', seq: 9, time: 1, group_id: 456,
    user_id: 789, sender: { user_id: 789 }, message: [{ type: 'text', text: '原消息' }] }
  const contact = { getMsg: async () => original,
    sendMsg: async (message, quote) => { sent.push({ message, quote }); return { message_id: 'native-sent' } } }
  const account = { uin: 123, nickname: '测试账号', pickGroup: () => contact, pickFriend: () => contact }
  const context = vm.createContext({ Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    console, logger: new Proxy({}, { get: () => () => {} }), Bot: { uin: [123], 123: account },
    segment: Object.fromEntries(['image', 'record', 'video', 'at', 'face'].map(type => [type, file => ({ type, file })])) })
  const config = { heartbeatInterval: 0, noMsgInclude: [] }
  const cache = new Map()
  const synthetic = (exports, id) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
  }, { context, identifier: id })
  const db = { getMsg: async query => mappings.get(query.onebot_id ?? query.message_id),
    setMsg: async value => { await delay(5); mappings.set(value.onebot_id, value); mappings.set(value.message_id, value) },
    getLatestMsg: () => null, getUser_id: async value => value.user_id ?? value.custom,
    getGroup_id: async value => value.group_id ?? value.custom }
  let api
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const mod = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, mod)
    await mod.link(async (specifier, referencing) => {
      if (specifier.endsWith('components/index.js') || specifier === './index.js') return synthetic({ Config: config, Version: { version: 'test' } }, specifier)
      if (specifier.endsWith('/DataBase.js')) return synthetic(db, specifier)
      if (specifier.endsWith('/tool.js')) return synthetic({ TMP_DIR: '.', decodeHtml: x => x, SendMusicShare: async () => {} }, specifier)
      if (specifier.includes('/lib/common/')) return synthetic({ default: {} }, specifier)
      if (specifier === 'node-fetch') return synthetic({ default: fetch }, specifier)
      if (specifier === 'express') return synthetic({ default: () => {} }, specifier)
      if (specifier === '../model/index.js') return synthetic({ getApiData: (...args) => api.getApiData(...args),
        makeGSUidSendMsg: () => {}, getLatestMsg: db.getLatestMsg, setMsg: db.setMsg,
        lifecycle: id => JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect', self_id: id }), heartbeat: () => '{}' }, specifier)
      if (specifier.startsWith('.')) return load(new URL(specifier, referencing.identifier))
      return synthetic(await import(specifier), specifier)
    })
    return mod
  }
  const msgModule = await load(new URL('../model/makeMsg.js', import.meta.url)); await msgModule.evaluate()
  const apiModule = await load(new URL('../model/api.js', import.meta.url)); await apiModule.evaluate(); api = apiModule.namespace
  const clientModule = await load(new URL('../components/Client.js', import.meta.url)); await clientModule.evaluate()
  return { msg: msgModule.namespace, api, Client: clientModule.namespace.default, mappings, sent, original, account }
}

test('真实发送入口兼容文字与图片混合数组、单个消息段及 URL 转义', async () => {
  const f = await fixture()
  const response = await f.api.getApiData('send_group_msg', { group_id: 456,
    message: ['文字', { type: 'image', data: { file: 'https://example.com/a%25b.png' } }] }, 'Sakura', 123)
  assert.equal(f.sent[0].message[0], '文字')
  assert.equal(f.sent[0].message[1].file, 'https://example.com/a%25b.png')
  assert.equal(f.mappings.get(response.message_id).message_id, 'native-sent')
  await f.api.getApiData('send_private_msg', { user_id: 789, message: { type: 'image', data: { url: 'https://example.com/image.png' } } }, 'Sakura', 123)
  assert.equal(f.sent[1].message[0].file, 'https://example.com/image.png')
})

test('图片支持 base64 和 Buffer，CQ 字符串仍可发送', async () => {
  const f = await fixture()
  const result = await f.msg.makeSendMsg({ message: [{ type: 'image', data: { file: Buffer.from('image') } }] }, 123)
  assert.equal(result.sendMsg[0].file, 'base64://aW1hZ2U=')
  const cq = await f.msg.makeSendMsg({ message: '你好[CQ:image,file=base64://aW1hZ2U=]' }, 123)
  assert.equal(cq.sendMsg[0], '你好')
  assert.equal(cq.sendMsg[1].file, 'base64://aW1hZ2U=')
})

test('没有 bot.getMsg 时引用回复和 get_msg 均使用联系人接口', async () => {
  const f = await fixture()
  f.mappings.set(9, { message_id: 'native-9', onebot_id: 9, group_id: 456, seq: 9 })
  await f.api.getApiData('send_group_msg', { group_id: 456,
    message: [{ type: 'reply', data: { id: 9 } }, '引用回复'] }, 'Sakura', 123)
  assert.equal(f.sent[0].quote, f.original)
  const response = await f.api.getApiData('get_msg', { message_id: 9 }, 'Sakura', 123)
  assert.equal(response.message_id, 9)
  assert.equal(response.message[0].data.text, '原消息')
})

test('上报完成前已写入消息映射，避免立即回复时查不到引用', async () => {
  const f = await fixture()
  await f.msg.makeOneBotReportMsg({ message_id: 'native-9', group_id: 456,
    message: [{ type: 'text', text: '命令' }], param: { message_id: 9 } })
  assert.equal(f.mappings.get(9).message_id, 'native-9')
})

test('真实 WebSocket 完成 Bearer 握手、收取 Sakura 发送指令并返回 echo', async t => {
  const f = await fixture()
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const client = new f.Client({ name: 'Sakura', uin: 123, type: 1,
    address: `ws://127.0.0.1:${server.address().port}`, accessToken: 'test-token', maxReconnectAttempts: 1 })
  t.after(async () => { client.close(); for (const ws of server.clients) ws.terminate(); await new Promise(resolve => server.close(resolve)) })
  const connected = once(server, 'connection', { signal: AbortSignal.timeout(3000) }); client.createWs()
  const [socket, req] = await connected
  assert.equal(req.headers.authorization, 'Bearer test-token')
  await once(socket, 'message', { signal: AbortSignal.timeout(3000) }) // 生命周期上报
  const reply = once(socket, 'message', { signal: AbortSignal.timeout(3000) })
  socket.send(JSON.stringify({ action: 'send_group_msg', params: { group_id: 456,
    message: ['回复', { type: 'image', data: { file: 'base64://aW1hZ2U=' } }] }, echo: 'sakura-test' }))
  const [raw] = await reply
  const response = JSON.parse(raw)
  assert.equal(response.status, 'ok')
  assert.equal(response.echo, 'sakura-test')
  assert.equal(f.sent[0].message[1].file, 'base64://aW1hZ2U=')
  const error = await client.getData('send_group_msg', { group_id: 456, message: [null] }, 'bad')
  assert.equal(error.status, 'failed')
  assert.match(error.message, /无效/)
})

test('直接连接未经修改的 Sakura OB11 反向端完成发送和引用', async t => {
  let OneBotWsClient
  try { ({ OneBotWsClient } = await import('../../../src/core/wsClient.js')) }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    t.skip('当前目录旁没有 Sakura 框架，仅运行插件独立回归')
    return
  }
  const f = await fixture()
  const sakura = new OneBotWsClient({ mode: 'reverse', reversePort: 0, accessToken: 'test-token' })
  await sakura.connect()
  const client = new f.Client({ name: 'Sakura', uin: 123, type: 1,
    address: `ws://127.0.0.1:${sakura._wsServer.address().port}`, accessToken: 'test-token', maxReconnectAttempts: 1 })
  t.after(() => { client.close(); sakura.disconnect() })
  const online = once(sakura, 'meta_event.lifecycle.connect', { signal: AbortSignal.timeout(3000) })
  client.createWs()
  await online
  f.mappings.set(9, { message_id: 'native-9', onebot_id: 9, group_id: 456, seq: 9 })
  const result = await sakura.send('send_group_msg', { group_id: 456,
    message: [{ type: 'reply', data: { id: 9 } }, 'Sakura 回复',
      { type: 'image', data: { file: 'base64://aW1hZ2U=' } }] }, { selfId: 123 })
  assert.ok(result.message_id !== undefined)
  assert.equal(f.sent[0].quote, f.original)
  assert.equal(f.sent[0].message[1].file, 'base64://aW1hZ2U=')
  await assert.rejects(sakura.send('send_group_msg', { group_id: 456, message: [null] }, { selfId: 123 }), /无效/)
})

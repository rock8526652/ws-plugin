import Client from './Client.js'
import { Config, Version } from './index.js'
import { getUser_id } from '../model/index.js'
import { redAdapter } from '../model/red/index.js'
import _ from 'lodash'

let sendSocketList = []
let allSocketList = []

// 全局模式（未配置 uin）的 Bot 上线监控
const globalModeOriginalConfigs = [] // 保存未变异的原始配置
const globalModeInitializedUins = new Set() // 已建立连接的 uin
let botMonitorTimer = null

const adapterName = {
  qg_: {
    name: 'QQGuild',
    user_like: 'qg_%',
    group_like: 'qg_%',
    gsBotId: 'qqguild'
  },
  wx_: {
    name: 'WeChat',
    user_like: 'wx_%',
    group_like: 'wx_%'
  },
  wxi: {
    name: 'WeChat',
    user_like: 'wxid_%',
    group_like: '%@chatroom'
  },
  mv_: {
    name: 'mysVilla',
    user_like: 'mv_%',
    group_like: 'mv_%',
    gsBotId: 'villa'
  },
  ko_: {
    name: 'KOOK',
    user_like: 'ko_%',
    group_like: 'ko_%',
    gsBotId: 'kook'
  },
  tg_: {
    name: 'Telegram',
    user_like: 'tg_%',
    group_like: 'tg_%',
    gsBotId: 'telegram'
  },
  dc_: {
    name: 'Discord',
    user_like: 'dc_%',
    group_like: 'dc_%',
    gsBotId: 'discord'
  },
  std: {
    name: 'stdin',
    user_like: 'std%',
    group_like: 'std%'
  }
}

async function createWebSocket (data) {
  if (typeof data.close != 'undefined' && typeof data.closed == 'undefined') {
    data.closed = data.close
    delete data.close
  }
  data.rawName = data.rawName || data.name

  // uin 为空时，自动填充所有已连接的 Bot uin
  // 必须在数组拆分检查之前执行
  if (!data.uin && !data._uinResolved) {
    const allUins = Array.isArray(Bot.uin) ? Bot.uin.filter(u => u) : (Bot.uin ? [Bot.uin] : [])
    if (allUins.length === 0) {
      logger.warn(`[ws-plugin] ${data.name} 未配置uin且无可用Bot，跳过`)
      return
    }
    if (allUins.length === 1) {
      data.uin = allUins[0]
      logger.mark(`[ws-plugin] ${data.name} 未配置uin，自动使用Bot: ${data.uin}`)
    } else {
      data.uin = allUins
      logger.mark(`[ws-plugin] ${data.name} 未配置uin，全局模式：为 ${allUins.length} 个Bot各建连接`)
    }
    data._uinResolved = true
  }

  if (Array.isArray(data.uin)) {
    for (const uin of data.uin) {
      const str = String(uin)
      const i = _.cloneDeep(data)
      i.name += `(${str.slice(0, 4) + '...' + str.slice(-2)})`
      i.rawName = data.name
      i.uin = uin
      await createWebSocket(i)
    }
    return
  }
  const client = new Client(data)
  const getQQBotAdapter = (self_id) => ({
    name: 'QQBot',
    user_like: [
      self_id + '%',
      'qg_%'
    ],
    group_like: [
      self_id + '%',
      'qg_%'
    ],
    gsBotId: 'qqgroup'
  })
  const isQQBotLikeId = (self_id) => {
    if (!self_id) return false
    return (/^(2854|3889|401)/.test(self_id) && self_id.length === 10) || (!Version.isTrss && self_id.startsWith('1020') && self_id.length === 9)
  }

  const botAdapterId = Bot?.[client.uin]?.adapter?.id || Bot?.[client.self_id]?.adapter?.id

  if (typeof client.self_id === 'string') {
    client.self_id = await getUser_id({ user_id: client.self_id })
    client.adapter = adapterName[client.uin?.substring?.(0, 3)]
    const self_id = String(client.self_id)
    if (!client.adapter && (botAdapterId === 'QQBot' || isQQBotLikeId(self_id))) {
      client.adapter = getQQBotAdapter(self_id)
    }
  } else {
    const self_id = String(client.self_id)
    if (botAdapterId === 'QQBot' || isQQBotLikeId(self_id)) {
      client.adapter = getQQBotAdapter(self_id)
    }
  }
  setAllSocketList(client)
  if (data.address == 'ws_address') return
  if (data.closed) return
  sendSocketList = sendSocketList.filter(i => i.name != data.name)
  switch (Number(data.type)) {
    case 1:
      if (!await checkVersion(data)) return
      client.createWs()
      sendSocketList.push(client)
      break
    case 2:
      if (!await checkVersion(data)) return
      client.createServer()
      sendSocketList.push(client)
      break
    case 3:
      if (!await checkVersion(data)) return
      client.createGSUidWs()
      sendSocketList.push(client)
      break
    case 4:
      // if (Version.isTrss) return
      // client.createQQNT()
      redAdapter.connect(client)
      break
    case 5:
      if (!await checkVersion(data)) return
      client.createHttp()
      break
    case 6:
      if (!await checkVersion(data)) return
      client.createHttpPost()
      sendSocketList.push(client)
      break
    default:
  }
}

function setAllSocketList (data) {
  allSocketList = allSocketList.filter(i => i.name != data.name)
  allSocketList.push(data)
}

async function checkVersion (data) {
  // uin 解析已在 createWebSocket 入口处完成
  // 此处仅做最终校验
  if (!data.uin) {
    logger.warn(`[ws-plugin] ${data.name} 缺少配置项uin，请删除连接后重新#ws添加连接`)
    return false
  }
  return true
}

async function modifyWebSocket (target) {
  // if (Version.isTrss) return
  switch (target.type) {
    case 'add':
    case 'open':
      if (target.data.type == 4) {
        const client = new Client(target.data)
        setAllSocketList(client)
        redAdapter.connect(client)
      } else {
        await createWebSocket(target.data)
      }
      break
    case 'del':
    case 'close':
      for (const i of allSocketList) {
        // eslint-disable-next-line no-useless-escape
        const reg = new RegExp(`^${target.data.name}\(.{1,6}\)$`)
        if (i.name == target.data.name || reg.test(i.name)) {
          i.close()
        }
      }
      break
    default:
  }
}

function clearWebSocket () {
  for (const i of allSocketList) {
    i.close()
  }
}

async function initWebSocket () {
  // if (Version.isTrss) return

  // 在 createWebSocket 变异配置之前，保存全局模式（未配置 uin）的原始配置
  globalModeOriginalConfigs.length = 0
  globalModeInitializedUins.clear()
  for (const i of Config.servers) {
    if (!i.uin && !i.closed && i.address !== 'ws_address') {
      globalModeOriginalConfigs.push(_.cloneDeep(i))
    }
  }

  for (const i of Config.servers) {
    await createWebSocket(i)
  }

  // 记录启动时已有的 uin
  const startupUins = Array.isArray(Bot.uin) ? Bot.uin.filter(u => u) : (Bot.uin ? [Bot.uin] : [])
  for (const uin of startupUins) {
    globalModeInitializedUins.add(uin)
  }

  // 启动新 Bot 上线监控
  startBotMonitor()
}

/**
 * 定期检查 Bot.uin，为新上线的 Bot 在全局模式连接上创建 Client
 */
function startBotMonitor () {
  if (botMonitorTimer) {
    clearInterval(botMonitorTimer)
    botMonitorTimer = null
  }
  if (globalModeOriginalConfigs.length === 0) return

  botMonitorTimer = setInterval(async () => {
    const currentUins = Array.isArray(Bot.uin) ? Bot.uin.filter(u => u) : (Bot.uin ? [Bot.uin] : [])

    for (const uin of currentUins) {
      if (globalModeInitializedUins.has(uin)) continue
      globalModeInitializedUins.add(uin)

      logger.mark(`[ws-plugin] 检测到新 Bot 上线: ${uin}，为全局模式连接创建实例`)

      for (const serverCfg of globalModeOriginalConfigs) {
        const str = String(uin)
        const data = _.cloneDeep(serverCfg)
        data.name = `${serverCfg.name}(${str.slice(0, 4) + '...' + str.slice(-2)})`
        data.rawName = serverCfg.name
        data.uin = uin
        data._uinResolved = true
        try {
          await createWebSocket(data)
        } catch (e) {
          logger.error(`[ws-plugin] 为 Bot ${uin} 创建 ${serverCfg.name} 连接失败: ${e}`)
        }
      }
    }
  }, 15000) // 每 15 秒检查一次
}

export {
  initWebSocket,
  clearWebSocket,
  modifyWebSocket,
  allSocketList,
  setAllSocketList,
  sendSocketList,
  createWebSocket
}

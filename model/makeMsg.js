import { Config, Version } from '../components/index.js'
import { MsgToCQ, CQToMsg } from './CQCode.js'
import { getMsg, setMsg, getUser_id } from './DataBase.js'
import { SendMusicShare, TMP_DIR, decodeHtml } from './tool.js'
import common from '../../../lib/common/common.js'
import { randomUUID } from 'crypto'
import fs from 'fs'
import fetch from 'node-fetch'
import { normalizeSendSegments, resolveQuotedMessage } from './SakuraCompat.js'

/**
 * 制作OneBot上报消息
 * @param {*} e
 * @returns
 */
async function makeOneBotReportMsg (e) {
  let reportMsg = await msgToOneBotMsg(e.message, e)
  if (reportMsg.length === 0) {
    return false
  }
  
  // --- LOGGING FOR REPLIES & FORWARDS ---
  const hasReply = e.source || (Array.isArray(e.message) && e.message.some(m => m.type === 'reply'))
  if (hasReply) {
    logger.debug(`[ws-plugin] 检测到引用/回复消息！`)
    logger.debug(`[ws-plugin] Yunzai e.source: ${JSON.stringify(e.source)}`)
    logger.debug(`[ws-plugin] Yunzai e.message中的reply段: ${JSON.stringify(e.message?.find?.(m => m?.type === 'reply'))}`)
    logger.debug(`[ws-plugin] 转换后的OneBot reply段: ${JSON.stringify(reportMsg?.find?.(m => m?.type === 'reply'))}`)
    logger.debug(`[ws-plugin] 当前消息 YzMsgId: ${e.message_id}, OneBotMsgId: ${e.param.message_id}, YzSeq: ${e.seq}`)
  }
  const hasForward = Array.isArray(e.message) && e.message.some(m => m.type === 'forward' || m.type === 'xml')
  if (hasForward) {
    logger.debug(`[ws-plugin] 检测到合并转发/XML消息！`)
    logger.debug(`[ws-plugin] Yunzai e.message 原数组: ${JSON.stringify(e.message)}`)
    logger.debug(`[ws-plugin] 转换后的OneBot reportMsg 数组: ${JSON.stringify(reportMsg)}`)
  }
  // ---------------------------

  let raw_message = MsgToCQ(reportMsg)
  if (e.messagePostFormat == 'string' || e.messagePostFormat == '1') {
    reportMsg = raw_message
  }
  await setMsg({
    message_id: e.message_id,
    time: e.time,
    seq: e.seq,
    rand: e.rand,
    user_id: e.user_id,
    group_id: e.group_id,
    onebot_id: e.param.message_id
  })
  let Message = {
    message: reportMsg,
    raw_message,
    ...e.param
  }

  return JSON.stringify(Message)
}

/**
 * 制作gsuid_core上报消息
 * @param {*} e
 * @returns
 */
async function makeGSUidReportMsg (e, botId = 'onebot') {
  let message = []
  let msg = e.message
  if (e.source) {
    message.push({
      type: 'reply',
      data: String(e.source.message_id)
    })
  }
  for (const i of msg) {
    switch (i.type) {
      case 'at':
        message.push({
          type: 'at',
          data: i.qq
        })
        break
      case 'text':
        if (Config.noMsgInclude.length > 0 && Array.isArray(Config.noMsgInclude)) {
          if (Config.noMsgInclude.some(item => i.text.includes(item))) {
            return []
          }
        }
        message.push({
          type: 'text',
          data: i.text
        })
        break
      case 'image':
        message.push({
          type: 'image',
          data: i.url
        })
        break
      case 'file': {
        if (e.isGroup || Version.isTrss) break
        let fileUrl = await e.friend.getFileUrl(e.file.fid)
        let res = await fetch(fileUrl)
        let arrayBuffer = await res.arrayBuffer()
        let buffer = Buffer.from(arrayBuffer)
        let base64 = buffer.toString('base64')
        let name = i.name
        message.push({
          type: 'file',
          data: `${name}|${base64}`
        })
        break
      }
      case 'reply':
        message.push({
          type: 'reply',
          data: String(i.id)
        })
        break
      default:
        break
    }
  }
  if (message.length == 0) {
    return false
  }
  let user_pm = 6
  if (e.isMaster) {
    user_pm = 1
  } else if (e.isGroup) {
    if (e.sender.role === 'owner') {
      user_pm = 2
    } else if (e.sender.role === 'admin') {
      user_pm = 3
    }
  }
  const MessageReceive = {
    bot_id: botId,
    bot_self_id: String(e.self_id),
    msg_id: String(e.message_id),
    user_id: String(e.user_id),
    user_pm,
    content: message,
    sender: {
      ...e.sender,
      user_id: String(e.user_id)
    }
  }
  if (e.avatar) {
    MessageReceive.sender.avatar = e.avatar
  }
  if (e.isGroup) {
    MessageReceive.user_type = 'group'
    MessageReceive.group_id = String(e.group_id)
  } else if (e.isGuild) {
    MessageReceive.user_type = 'channel'
    MessageReceive.group_id = String(e.group_id)
  } else {
    MessageReceive.user_type = 'direct'
  }
  return Buffer.from(JSON.stringify(MessageReceive))
}

/**
 * 制作gsuid发送消息
 * @param {*} data
 */
async function makeGSUidSendMsg (data) {
  let content = data.content; let quote = null; let bot = Bot[data.bot_self_id] || Bot
  const sendMsg = []
  if (content[0].type.startsWith('log')) {
    logger.info(content[0].data)
  } else {
    let target = data.target_type == 'direct' ? 'pickFriend' : 'pickGroup'
    for (const msg of content) {
      switch (msg.type) {
        case 'image':
          if (!/^(http|base64|link)/.test(msg.data)) {
            msg.data = 'base64://' + msg.data
          }
          if (msg.data.startsWith('link://')) {
            msg.data = msg.data.replace('link://', '')
            if (!msg.data.startsWith('http')) {
              msg.data = 'http://' + msg.data
            }
          }
          sendMsg.push(segment.image(msg.data))
          break
        case 'text':
          sendMsg.push(msg.data)
          break
        case 'at':
          sendMsg.push(segment.at(Number(msg.data) || String(msg.data)))
          break
        case 'reply':
          quote = await bot.getMsg?.(msg.data) || await bot[target].getChatHistory?.(msg.data, 1)?.[0] || null
          break
        case 'file':{
          let file = msg.data.split('|')
          let buffer = Buffer.from(file[1], 'base64')
          bot.pickGroup(data.target_id)?.fs?.upload?.(buffer, '/', file[0])
          break
        }
        case 'node':{
          let arr = []
          for (const i of msg.data) {
            const { sendMsg: message } = await makeGSUidSendMsg({ content: [i], target_type: data.target_type, target_id: data.target_id })
            arr.push({
              message,
              nickname: '小助手',
              user_id: 2854196310
            })
          }
          sendMsg.push(await bot[target](data.target_id).makeForwardMsg?.(arr) || { type: 'node', data: arr })
          break
        }
        case 'template_markdown':{
          const markdown_parms = []
          for (const key in msg.data.para) {
            markdown_parms.push({ key, values: [msg.data.para[key]] })
          }
          const md = { custom_template_id: msg.data.template_id, params: markdown_parms }
          sendMsg.push(toMD(md))
          break
        }
        case 'buttons':
          sendMsg.push(toGSButton(msg.data))
          break
        case 'markdown':
          sendMsg.push(toMD(msg.data))
          break
        default:
          break
      }
    }
  }
  return { sendMsg, quote }
}

function toMD (data) {
  if (Version.isTrss) {
    return segment.markdown(data)
  } else {
    return {
      type: 'markdown',
      ...data
    }
  }
}

function toGSButton (rawButtons) {
  // 如果值均为Button，则按照预先设定行列发送（例如Nonebot2-qq为默认两个按钮一行）
  if (!rawButtons.every(i => Array.isArray(i))) {
    rawButtons = rawButtons.reduce((acc, cur, i) => {
      // 每行2个
      if (i % 2 == 0) {
        if (i < rawButtons.length - 1) {
          acc.push([cur, rawButtons[i + 1]])
        } else {
          acc.push([cur])
        }
      }
      return acc
    }, [])
  }
  const buttons = []
  for (const rawButton of rawButtons) {
    const button = []
    for (const i of rawButton) {
      const action = {
        0: 'link',
        1: 'callback',
        2: 'input'
      }[i.action] || 'input'
      const permission = {
        0: i.specify_user_ids,
        1: 'admin'
      }[i.permisson] || null
      // style 和 unsupport_tips 先不管
      button.push({
        text: i.text,
        [action]: i.data,
        clicked_text: i.pressed_text,
        send: i.enter,
        permission
      })
    }
    buttons.push(button)
  }
  if (Version.isTrss) {
    return segment.button(...buttons)
  } else {
    return Bot.Button(buttons)
  }
}

/**
 * 制作onebot发送的消息
 * @param {*} params
 * @returns sendMsg , quote
 */
async function makeSendMsg (params, uin, adapter) {
  const bot = Bot[uin] || Bot
  let msg = params.message
  if (typeof msg == 'string') msg = CQToMsg(msg)
  msg = normalizeSendSegments(msg)
  let target; let uid; let sendMsg = []; let quote = null
  for (const i of msg) {
    if (i.data.file) {
      // URL/base64 不需要整体解码；URL 内的 %25 等转义应交给协议端处理。
      let file = i.data.file
      if (Buffer.isBuffer(file)) file = `base64://${file.toString('base64')}`
      if (typeof file !== 'string') throw new Error('媒体消息的 file 必须为字符串或 Buffer')
      if (file.startsWith('file:///')) {
        let localFile
        try { localFile = decodeURIComponent(file) } catch { localFile = file }
        if (fs.existsSync(localFile.replace('file:///', ''))) {
          file = fs.readFileSync(localFile.replace('file:///', ''))
        } else
        // 有可能是linux
          if (fs.existsSync(localFile.replace('file://', ''))) {
            file = fs.readFileSync(localFile.replace('file://', ''))
          }
      }
      i.data.file = file
    }
    switch (i.type) {
      case 'reply':
        if (i.data.text) {
          quote = {
            message: i.data.text,
            user_id: i.data.qq,
            time: i.data.time,
            seq: i.data.seq
          }
        } else {
          const mapping = await getMsg({ onebot_id: i.data.id })
          quote = await resolveQuotedMessage(bot, mapping)
          if (!quote) logger.warn('[ws-plugin] 引用消息已过期或当前协议无法获取原消息')
          // else {
          //     sendMsg.push(MsgToCQ([i]))
          // }
        }
        break
      case 'image':
        sendMsg.push(segment.image(i.data.file))
        break
      case 'text':
        sendMsg.push(decodeHtml(i.data.text == null ? '' : String(i.data.text)))
        break
      case 'at': {
        let qq = i.data.qq
        if (adapter?.name) {
          if (qq != 'all') {
            qq = await getUser_id({ custom: qq, like: adapter.user_like })
          }
        }
        sendMsg.push(segment.at(Number(qq) || String(qq)))
      }
        break
      case 'video':
        if (typeof i.data.file === "string" && i.data.file.startsWith('http')) {
          const path = TMP_DIR + '/' + randomUUID({ disableEntropyCache: true }) + '.mp4'
          if (await common.downFile(i.data.file, path)) {
            sendMsg.push(segment.video(path))
            setTimeout(() => {
              fs.unlinkSync(path)
            }, 100000)
          } else {
            sendMsg.push(MsgToCQ([i]))
          }
        } else {
          sendMsg.push(segment.video(i.data.file))
        }
        break
      case 'music':
        if (params.message_type == 'group') {
          target = 'pickGroup'
          uid = params.group_id
        } else {
          target = 'pickFriend'
          uid = params.user_id
        }
        if (i.data.type == 'custom') {
          let data = i.data
          data.bot_id = uin
          data.message_type = params.message_type
          data.user_id = params.user_id
          data.group_id = params.group_id
          await SendMusicShare(data)
        } else {
          try {
            await bot[target](uid).shareMusic(i.data.type, i.data.id)
          } catch (error) {
            logger.warn('[ws-plugin] 分享歌曲失败,可能是当前协议不支持分享音乐')
          }
        }
        break
      case 'poke':
        // C5修复: 添加安全检查和私聊戳一戳支持
        if (params.group_id) {
          await bot.pickGroup(params.group_id)?.pokeMember?.(Number(i.data.qq))
        } else if (params.user_id) {
          await bot.pickFriend(params.user_id)?.poke?.(true)
        }
        break
      case 'record':
        sendMsg.push(segment.record(i.data.file))
        break
      case 'face':
        // C4修复: 使用segment.face()让ICQQ正确识别
        sendMsg.push(segment.face(Number(i.data.id)))
        break
      case 'node':{
        let data = {
          ...params,
          messages: [{ data: i.data }]
        }
        sendMsg.push(await makeForwardMsg(data))
        break
      }
      case 'json':
        sendMsg.push({ type: 'json', data: decodeHtml(i.data.data == null ? '' : String(i.data.data)) })
        break
      default:
        sendMsg.push(MsgToCQ([i]))
        logger.warn(`[ws-plugin] 出现了未适配的消息的类型${JSON.stringify(i)}`)
        break
    }
  }
  return { sendMsg, quote }
}

/**
 * 制作合并转发的消息
 * @param {*} params
 */
async function makeForwardMsg (params, uin, adapter) {
  let forwardMsg = []
  if (!Array.isArray(params.messages)) params.messages = [params.messages]
  for (const msg of params.messages) {
    if (typeof msg.data.content == 'string') {
      msg.data.content = [CQToMsg(msg.data.content)]
    }
    if (msg.data.content.type == 'image') {
      msg.data.content = [{
        type: 'image',
        data: {
          file: msg.data.content.file || msg.data.content.data.file
        }
      }]
    }
    if (!Array.isArray(msg.data.content)) {
      msg.data.content = [msg.data.content]
    }
    let node = null
    for (let i of msg.data.content) {
      if (i.type == 'node') {
        if (node) {
          node.messages.push({ data: i.data })
        } else {
          node = {
            ...params,
            messages: [{ data: i.data }]
          }
        }
        continue
      }
      if (!Array.isArray(i)) i = [i]
      const data = {
        ...params,
        message: i
      }
      let { sendMsg } = await makeSendMsg(data, uin, adapter)
      forwardMsg.push({
        nickname: msg.data.nickname,
        user_id: Number(msg.data.user_id),
        message: sendMsg
      })
    }
    if (node) {
      // C8修复: 统一字段名，同时兼容 name/uin 和 nickname/user_id
      forwardMsg.push({
        nickname: msg.data.name || msg.data.nickname,
        user_id: Number(msg.data.uin || msg.data.user_id),
        message: await makeForwardMsg(node)
      })
    }
  }
  const bot = Bot[uin] || Bot
  if (params.group_id) {
    forwardMsg = await bot.pickGroup(params.group_id).makeForwardMsg?.(forwardMsg) || { type: 'node', data: forwardMsg }
  } else if (params.user_id) {
    forwardMsg = await bot.pickFriend(params.user_id).makeForwardMsg?.(forwardMsg) || { type: 'node', data: forwardMsg }
  }
  return forwardMsg
}

/**
 * 转换成onebot消息
 * @returns
 */
async function msgToOneBotMsg (msg, e) {
  let reportMsg = []
  let hasReplySegment = false
  if (e?.source) {
    const keys = ['message_id', 'rand', 'seq']
    const getData = keys.reduce((obj, key) => {
      if (e.source[key] !== undefined) {
        obj[key] = e.source[key]
      }
      return obj
    }, {})
    const replyMsg = await getMsg(getData)
    logger.debug(`[ws-plugin] e.source 数据库查找结果: ${JSON.stringify(replyMsg)}`)
    if (replyMsg) {
      reportMsg.push({
        type: 'reply',
        data: {
          id: replyMsg.onebot_id
        }
      })
      hasReplySegment = true
    } else {
      // 如果 msg 数组中本来就有 reply 段，就优先让它去处理（因为它可能带有真实的 id）
      const hasReplyInMsg = msg.some(i => i.type === 'reply')
      logger.debug(`[ws-plugin] e.source 未在数据库找到, YzMsgId: ${e.source.message_id}, hasReplyInMsg: ${hasReplyInMsg}`)
      if (!hasReplyInMsg) {
        // 数据库查询失败（被引用的消息可能早于 ws-plugin 启动），
        // 创建一个回退 onebot_id 并存储映射，确保 get_msg API 仍可解析
        const fallbackId = Math.floor(Math.random() * Math.pow(2, 32)) | 0
        logger.debug(`[ws-plugin] 生成 fallback OneBot ID: ${fallbackId}`)
        const storeData = { onebot_id: fallbackId }
        if (e.source.message_id !== undefined) storeData.message_id = e.source.message_id
        if (e.source.seq !== undefined) storeData.seq = e.source.seq
        if (e.source.rand !== undefined) storeData.rand = e.source.rand
        if (e.source.user_id !== undefined) storeData.user_id = Number(e.source.user_id)
        if (e.group_id !== undefined) storeData.group_id = Number(e.group_id)
        if (e.user_id !== undefined && !storeData.group_id) storeData.user_id = Number(e.user_id)
        await setMsg(storeData)
        reportMsg.push({
          type: 'reply',
          data: {
            id: fallbackId
          }
        })
        hasReplySegment = true
      }
    }
  }
  for (const i of msg) {
    switch (i.type) {
      case 'at': {
        let qq = i.qq
        if (qq != 'all') {
          qq = await getUser_id({ user_id: qq })
        }
        reportMsg.push({
          type: 'at',
          data: {
            qq
          }
        })
        break
      }
      case 'text':
        if (Array.isArray(Config.noMsgInclude) && Config.noMsgInclude.length > 0) {
          if (Config.noMsgInclude.some(item => i.text.includes(item))) {
            return []
          }
        }
        reportMsg.push({
          type: 'text',
          data: {
            text: i.text
          }
        })
        break
      case 'image':
        reportMsg.push({
          type: 'image',
          data: {
            file: i.file,
            subType: i.asface ? 1 : 0,
            url: i.url
          }
        })
        break
      case 'mface':
      case 'marketface':
      case 'bface':
        if (i.url) {
          reportMsg.push({
            type: 'image',
            data: {
              file: i.file || i.emojiId || i.id,
              subType: 1,
              url: i.url
            }
          })
        } else {
          reportMsg.push({
            type: 'text',
            data: {
              text: '[商城表情包]'
            }
          })
        }
        break
      case 'video': {
        let url = i.file
        if (!url?.startsWith?.('http')) {
          if (!e?.group?.getVideoUrl) break
          url = await e.group.getVideoUrl(i.fid, i.md5)
        }
        reportMsg.push({
          type: 'video',
          data: {
            file: i.name || url,
            url
          }
        })
        break
      }
      case 'json':
        reportMsg.push({
          type: 'json',
          data: {
            data: i.data
          }
        })
        break
      case 'face':
        reportMsg.push({
          type: 'face',
          data: {
            id: i.id
          }
        })
        break
      case 'record':
        reportMsg.push({
          type: 'record',
          data: {
            file: i.file
          }
        })
        break
      // C1修复: 添加forward合并转发消息段处理
      case 'forward':
        reportMsg.push({
          type: 'forward',
          data: {
            id: i.id || i.resid || ''
          }
        })
        break
      // C2修复: 添加xml消息段处理
      case 'xml':
        reportMsg.push({
          type: 'xml',
          data: {
            data: i.data
          }
        })
        break
      // C3修复: 添加poke戳一戳消息段处理
      case 'poke':
        reportMsg.push({
          type: 'poke',
          data: {
            type: String(i.type || ''),
            id: String(i.id || ''),
            name: i.name || ''
          }
        })
        break
      // 添加reply消息段处理：部分适配器将reply放在e.message而非e.source中
      case 'reply': {
        const replyId = i.id || i.data?.id
        if (!hasReplySegment && replyId) {
          const replyMsg = await getMsg({ message_id: replyId })
          if (replyMsg) {
            reportMsg.push({
              type: 'reply',
              data: {
                id: replyMsg.onebot_id
              }
            })
          } else {
            const fallbackId = Math.floor(Math.random() * Math.pow(2, 32)) | 0
            await setMsg({
              message_id: replyId,
              onebot_id: fallbackId,
              group_id: e?.group_id ? Number(e.group_id) : undefined,
              user_id: e?.user_id ? Number(e.user_id) : undefined
            })
            reportMsg.push({
              type: 'reply',
              data: {
                id: fallbackId
              }
            })
          }
          hasReplySegment = true
        }
        break
      }
      default:
        break
    }
  }
  return reportMsg
}

export {
  makeOneBotReportMsg,
  makeGSUidReportMsg,
  makeSendMsg,
  makeForwardMsg,
  makeGSUidSendMsg,
  msgToOneBotMsg
}

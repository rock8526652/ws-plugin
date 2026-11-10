import * as Components from '../components/index.js'
import { MsgToCQ, CQToMsg } from './CQCode.js'
import { normalizeSendSegments } from './SakuraCompat.js'
import { getUser_id, getGroup_id } from './DataBase.js'

/**
 * 上报机器人自身发送的消息（OneBot v11 / NapCat 扩展 post_type = message_sent）。
 * ICQQ 不会把自己发出的群消息作为事件推送，而 Sakura 依赖 message_sent
 * 把机器人自己的发言写入群聊上下文；缺少它时 AI 读不到自己上一条回复。
 */

/** 去掉 base64 / Buffer 等大体积内容，只保留可读的字段 */
function sanitizeSegments (segments) {
  return segments.map(seg => {
    const data = { ...(seg.data || {}) }
    for (const key of ['file', 'url']) {
      const v = data[key]
      if (Buffer.isBuffer(v) || (typeof v === 'string' && v.startsWith('base64://'))) {
        if (key === 'file') data.file = `${seg.type}.base64`
        else delete data.url
      }
    }
    if (seg.type === 'image' && typeof data.file === 'string' && /^https?:\/\//.test(data.file) && !data.url) {
      data.url = data.file
    }
    return { type: seg.type, data }
  })
}

export async function reportSelfSent ({ api, params, uin, bot, onebot_id, sendRet }) {
  try {
    const sockets = (Components.sendSocketList || []).filter(i =>
      i.status == 1 && [1, 2, 6].includes(Number(i.type)) && i.uin == uin)
    if (sockets.length === 0) return

    let message
    if (/forward/.test(api)) {
      message = [{ type: 'forward', data: { id: sendRet?.forward_id || '' } }]
    } else {
      let raw = params.message
      if (typeof raw === 'string') raw = CQToMsg(raw)
      message = sanitizeSegments(normalizeSendSegments(raw))
        .filter(seg => seg.type !== 'node')
    }
    if (!message.length) return

    const isGroup = !!params.group_id && params.message_type !== 'private'
    const self_id = await getUser_id({ user_id: uin })
    let card = ''
    let role = 'member'
    if (isGroup) {
      try {
        const member = bot.gml?.get?.(Number(params.group_id))?.get?.(Number(uin))
        card = member?.card || ''
        role = member?.role || 'member'
      } catch { }
    }
    const event = {
      time: sendRet?.time || Math.floor(Date.now() / 1000),
      self_id,
      post_type: 'message_sent',
      message_type: isGroup ? 'group' : 'private',
      sub_type: isGroup ? 'normal' : 'friend',
      message_id: onebot_id,
      message_seq: sendRet?.seq,
      real_id: sendRet?.seq,
      user_id: self_id,
      font: 14,
      message_format: 'array',
      sender: { user_id: self_id, nickname: bot.nickname || '', card, role }
    }
    if (isGroup) event.group_id = await getGroup_id({ group_id: params.group_id })
    else event.target_id = await getUser_id({ user_id: params.user_id })

    const raw_message = MsgToCQ(message)
    for (const socket of sockets) {
      const format = socket.other?.messagePostFormat || Components.Config?.messagePostFormat
      const payload = { ...event, message: (format == 'string' || format == '1') ? raw_message : message, raw_message }
      socket.ws.send(JSON.stringify(payload))
    }
  } catch (err) {
    logger.debug(`[ws-plugin] message_sent 上报失败: ${err?.message || err}`)
  }
}

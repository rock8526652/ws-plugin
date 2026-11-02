import { join } from 'path'
import fetch from 'node-fetch'
import { randomUUID } from 'crypto'
import { TMP_DIR } from './tool.js'
import { MsgToCQ, CQToMsg } from './CQCode.js'
import common from '../../../lib/common/common.js'
import { Version } from '../components/index.js'
import { makeSendMsg, makeForwardMsg, msgToOneBotMsg } from './makeMsg.js'
import { getMsg, setMsg, getLatestMsg, getUser_id, getGroup_id } from './DataBase.js'

async function getApiData (api, params = {}, name, uin, adapter, other = {}) {
  const bot = Bot[uin] || Bot
  let sendRet = null
  let ResponseData = null
  if (adapter) {
    if (params.user_id) {
      if (params.user_id == uin && adapter.name == 'QQBot') {
        params.user_id = String(params.user_id)
      } else {
        params.user_id = await getUser_id({ custom: params.user_id, like: adapter.user_like })
      }
    }
    if (params.group_id) {
      params.group_id = await getGroup_id({ custom: params.group_id, like: adapter.group_like })
    }
  }
  let publicApi = {
    // --------------------------------------------------------
    // Bot 账号
    // 有关 Bot 账号的相关 API
    // --------------------------------------------------------

    // 获取登录号信息
    get_login_info: async params => {
      ResponseData = {
        user_id: await getUser_id({ user_id: uin }),
        nickname: bot.nickname
      }
    },
    // 设置登录号资料
    set_qq_profile: async params => {
      // company公司 email邮箱 college学校 在icqq文档中没找到
      if (params.nickname) {
        await bot.setNickname?.(params.nickname)
      }
      if (params.personal_note) {
        await bot.setDescription?.(params.personal_note)
      }
    },
    // 获取企点账号信息
    // TODO qidian_get_account_info
    // 获取在线机型
    // TODO _get_model_show
    // 设置在线机型
    _set_model_show: async params => {
      // TODO 不会改
    },
    // 获取当前账号在线客户端列表
    get_online_clients: async params => {
      // TODO 不会获取
      ResponseData = {
        clients: []
      }
    },

    // --------------------------------------------------------
    // 好友信息
    // --------------------------------------------------------

    // 获取陌生人信息
    get_stranger_info: async (params) => {
      ResponseData = await bot.getStrangerInfo?.(params.user_id) || await (bot.pickUser(params.user_id))?.getSimpleInfo?.() || await (bot.pickUser(params.user_id))?.getInfo?.()
      if (!ResponseData) {
        ResponseData = {
          user_id: await getUser_id({ user_id: params.user_id }),
          nickname: adapter?.name || 'QQ用户',
          sex: 'unknown',
          age: 18
        }
      }
    },
    // 获取好友列表
    get_friend_list: async params => {
      let list = await bot.getFriendArray?.() || await bot.getFriendList?.() || []
      if (Array.isArray(list)) {
        ResponseData = list
      } else if (list instanceof Map) {
        ResponseData = Array.from(list.values())
      }
      for (const i in ResponseData) {
        ResponseData[i].user_id = await getUser_id({ user_id: ResponseData[i].user_id })
      }
    },
    // 获取单向好友列表
    get_unidirectional_friend_list: async params => {
      // 感觉不像这个
      // ResponseData = Array.from(bot.sl.values())
      ResponseData = []
    },

    // --------------------------------------------------------
    // 好友操作
    // 好友操作 API
    // --------------------------------------------------------

    // 发送名片赞
    send_like: async params => {
      ResponseData = await bot.sendLike?.(params.user_id, params.times) ?? false;
      if (!ResponseData) {
        throw { message: '今日同一好友点赞数已达上限', noLog: true };
      }
    },
    // 删除好友
    delete_friend: async params => {
      await bot.deleteFriend?.(params.user_id) || await bot.pickFriend(params.user_id)?.delete?.()
    },
    // 删除单向好友
    // TODO delete_unidirectional_friend

    // --------------------------------------------------------
    // 消息
    // 有关消息操作的 API
    // --------------------------------------------------------

    // 发送私聊消息
    send_private_msg: async (params) => {
      let { sendMsg, quote } = await makeSendMsg(params, uin, adapter)
      if (sendMsg.length == 0) return
      if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
        const msg = getLatestMsg(params.user_id)
        if (msg) {
          await msg.reply(sendMsg)
          return
        }
      }
      sendRet = await bot.pickFriend?.(params.user_id).sendMsg?.(sendMsg, quote)
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    // 发送群聊消息
    send_group_msg: async (params) => {
      let { sendMsg, quote } = await makeSendMsg(params, uin, adapter)
      if (sendMsg.length == 0) return
      if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
        const msg = getLatestMsg(params.group_id)
        if (msg) {
          await msg.reply(sendMsg)
          return
        }
      }
      sendRet = await bot.pickGroup?.(params.group_id).sendMsg?.(sendMsg, quote)
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    // 发送消息
    send_msg: async (params) => {
      let { sendMsg, quote } = await makeSendMsg(params, uin, adapter)
      if (sendMsg.length == 0) return
      if (params.message_type == 'group' || params.group_id) {
        if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
          const msg = getLatestMsg(params.group_id)
          if (msg) {
            await msg.reply(sendMsg)
            return
          }
        }
        sendRet = await bot.pickGroup?.(params.group_id).sendMsg?.(sendMsg, quote)
      } else if (params.message_type == 'private' || params.user_id) {
        if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
          const msg = getLatestMsg(params.user_id)
          if (msg) {
            await msg.reply(sendMsg)
            return
          }
        }
        sendRet = await bot.pickFriend?.(params.user_id).sendMsg?.(sendMsg, quote)
      }
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    // 获取消息
    get_msg: async (params) => {
      if (Array.isArray(params.message_id)) params.message_id = params.message_id[0]
      else if (params.message_id && typeof params.message_id === 'object') params.message_id = params.message_id.id || params.message_id.message_id || params.message_id.resid
      logger.debug(`[ws-plugin] get_msg 被调用, params: ${JSON.stringify(params)}`)
      const oldMsg = await getMsg({ onebot_id: params.message_id })
      logger.debug(`[ws-plugin] get_msg 数据库查找结果 oldMsg: ${JSON.stringify(oldMsg)}`)
      if (oldMsg) {
        let msg
        try {
          msg = await bot.getMsg?.(oldMsg.message_id)
        } catch (e) {
          logger.debug(`[ws-plugin] get_msg: bot.getMsg 抛出异常: ${e?.message || e}`)
        }
        if (!msg) {
          try {
            if (oldMsg.group_id) {
              msg = await bot.pickGroup(oldMsg.group_id)?.getMsg?.(oldMsg.message_id)
              if (!msg) {
                const history = await bot.pickGroup(oldMsg.group_id)?.getChatHistory?.(oldMsg.seq, 1)
                if (history && history.length > 0) msg = history[0]
              }
            } else if (oldMsg.user_id) {
              msg = await bot.pickFriend(oldMsg.user_id)?.getMsg?.(oldMsg.message_id)
              if (!msg) {
                const history = await bot.pickFriend(oldMsg.user_id)?.getChatHistory?.(oldMsg.time, 1)
                if (history && history.length > 0) msg = history[0]
              }
            }
          } catch (e) {
            logger.debug(`[ws-plugin] get_msg: pickGroup/Friend.getMsg 抛出异常: ${e?.message || e}`)
          }
        }
        logger.debug(`[ws-plugin] get_msg 协议端获取消息结果: ${msg ? '成功' : '失败'}`)
        if (msg) {
          const message = await msgToOneBotMsg(msg.message)
          msg.sender.level = String(msg.sender.level);
          ResponseData = {
            time: msg.time,
            message_type: 'private',
            sender: msg.sender,
            real_id: Number(oldMsg.onebot_id || msg.seq),
            message_id: Number(oldMsg.onebot_id || msg.rand),
            seq: Number(oldMsg.onebot_id || msg.seq),
            message_seq: Number(oldMsg.onebot_id || msg.seq),
            message,
            raw_message: MsgToCQ(message)
          }
          if (msg.user_id) {
            const user_id = await getUser_id({ user_id: msg.user_id })
            ResponseData.sender = {
              ...ResponseData.sender,
              user_id
            }
          }
          if (msg.group_id) {
            ResponseData.message_type = 'group'
            ResponseData.group = true
            ResponseData.group_id = await getGroup_id({ group_id: msg.group_id })
          }
          logger.debug(`[ws-plugin] get_msg 最终返回数据 ResponseData: ${JSON.stringify(ResponseData)}`)
        } else {
          logger.debug(`[ws-plugin] get_msg 失败，找不到对应消息内容`)
          throw { message: 'get_msg API error', noLog: true }
        }
      } else {
        logger.debug(`[ws-plugin] get_msg 失败，数据库中不存在此 onebot_id`)
        throw { message: 'get_msg API error', noLog: true }
      }
    },
    // 撤回消息
    delete_msg: async (params) => {
      let msg = await getMsg({ onebot_id: params.message_id })
      if (msg) {
        try {
          await bot.deleteMsg(msg.message_id)
        } catch (error) {
          if (msg.group_id) {
            await bot.pickGroup(msg.group_id)?.recallMsg?.(msg.message_id)
          } else if (msg.user_id) {
            await bot.pickFriend(msg.user_id)?.recallMsg?.(msg.message_id)
          }
        }
      }
    },
    // 标记消息已读
    mark_msg_as_read: async params => {
      // TODO
    },
    // 获取合并转发内容
    get_forward_msg: async params => {
      let id = params.id || params.message_id
      if (id && typeof id === 'object') {
        id = id.id || id.message_id || id.resid
      }
      logger.debug(`[ws-plugin] get_forward_msg 被调用, params: ${JSON.stringify(params)}, 解析出的 id: ${id}`)
      
      if (id) {
        let dbMsg = await getMsg({ onebot_id: id })
        if (dbMsg?.message_id) {
          logger.debug(`[ws-plugin] get_forward_msg 数据库找到映射, onebot_id: ${id} => message_id/resid: ${dbMsg.message_id}`)
          id = dbMsg.message_id
        }
      }
      
      let result = []
      if (typeof bot.getForwardMsg === 'function') {
        result = await bot.getForwardMsg(id)
      } else {
        const dummyFriend = bot.pickFriend?.(bot.uin || 0)
        if (dummyFriend && typeof dummyFriend.getForwardMsg === 'function') {
          result = await dummyFriend.getForwardMsg(id)
        } else {
          const dummyGroup = bot.pickGroup?.(0)
          if (dummyGroup && typeof dummyGroup.getForwardMsg === 'function') {
            result = await dummyGroup.getForwardMsg(id)
          }
        }
      }
      result = result || []

      let messages = []
      for (const item of result) {
        const itemMsg = item.message || item.content || []
        const sender = item.sender || {}
        const onebotMsg = await msgToOneBotMsg(itemMsg)
        messages.push({
          message: onebotMsg,
          content: MsgToCQ(onebotMsg),
          raw_message: MsgToCQ(onebotMsg),
          sender: {
            nickname: sender.nickname || item.nickname || "未知用户",
            user_id: await getUser_id({ user_id: sender.user_id || item.user_id || 0 })
          },
          time: item.time
        })
      }
      ResponseData = {
        messages
      }
      logger.debug(`[ws-plugin] get_forward_msg 返回结果 messages 长度: ${messages.length}`)
    },
    // 发送合并转发
    send_forward_msg: async (params) => {
      let forwardMsg = await makeForwardMsg(params, uin, adapter)
      let forward_id
      if (typeof (forwardMsg.data) === 'object') {
        let detail = forwardMsg.data?.meta?.detail
        if (detail) forward_id = detail.resid
      } else {
        let match = forwardMsg.data.match(/m_resid="(.*?)"/)
        if (match) forward_id = match[1]
      }
      if (params.group_id) {
        if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
          const msg = getLatestMsg(params.group_id)
          if (msg) {
            await msg.reply(forwardMsg)
            return
          }
        }
        sendRet = await bot.pickGroup(params.group_id).sendMsg(forwardMsg)
      } else if (params.user_id) {
        if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
          const msg = getLatestMsg(params.user_id)
          if (msg) {
            await msg.reply(forwardMsg)
            return
          }
        }
        sendRet = await bot.pickFriend(params.user_id).sendMsg(forwardMsg)
      }
      if (sendRet && forward_id) {
        sendRet.forward_id = forward_id
      }
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    // 发送合并转发 ( 群聊 )
    send_group_forward_msg: async (params) => {
      let forwardMsg = await makeForwardMsg(params, uin, adapter)
      let forward_id
      if (typeof (forwardMsg.data) === 'object') {
        let detail = forwardMsg.data?.meta?.detail
        if (detail) forward_id = detail.resid
      } else {
        let match = forwardMsg.data?.match(/m_resid="(.*?)"/)
        if (match) forward_id = match[1]
      }
      if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
        const msg = getLatestMsg(params.group_id)
        if (msg) {
          await msg.reply(forwardMsg)
          return
        }
      }
      sendRet = await bot.pickGroup(params.group_id).sendMsg(forwardMsg)
      if (sendRet && forward_id) {
        sendRet.forward_id = forward_id
      }
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    // 发送合并转发 ( 好友 )
    send_private_forward_msg: async (params) => {
      let forwardMsg = await makeForwardMsg(params, uin, adapter)
      let forward_id
      if (typeof (forwardMsg.data) === 'object') {
        let detail = forwardMsg.data?.meta?.detail
        if (detail) forward_id = detail.resid
      } else {
        let match = forwardMsg.data.match(/m_resid="(.*?)"/)
        if (match) forward_id = match[1]
      }
      if (adapter?.name == 'QQBot' || adapter?.name == 'QQGuild') {
        const msg = getLatestMsg(params.user_id)
        if (msg) {
          await msg.reply(forwardMsg)
          return
        }
      }
      sendRet = await bot.pickFriend(params.user_id).sendMsg(forwardMsg)
      if (sendRet && forward_id) {
        sendRet.forward_id = forward_id
      }
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    // 获取群消息历史记录
    // B1修复: 将获取到的ret转换后填入messages
    // B11修复: message_seq直接作为seq使用，不再错误地查找params.message_id
    get_group_msg_history: async (params) => {
      let messages = [];
      let seq = 0;
      let ret;
      if (params.message_seq) {
        // message_seq 可能是原始seq，也可能是onebot_id
        // 先尝试从数据库查找对应的seq
        let dbMsg = await getMsg({ onebot_id: params.message_seq })
        if (dbMsg) {
          if (bot.adapter?.name === 'OneBotv11' || bot.sendApi) {
            seq = dbMsg.message_id || dbMsg.seq || params.message_seq;
          } else {
            seq = dbMsg.seq;
          }
        } else {
          // 如果数据库没有，直接把 message_seq 当作 seq 使用
          seq = params.message_seq;
        }
      }
      ret = await bot
        .pickGroup(params.group_id)
        .getChatHistory?.(seq, params.count);
      if (Array.isArray(ret)) {
        for (const msg of ret) {
          try {
            const message = await msgToOneBotMsg(msg.message)
            messages.push({
              time: msg.time,
              message_type: 'group',
              message_id: msg.rand || msg.message_id,
              real_id: msg.seq,
              sender: {
                user_id: await getUser_id({ user_id: msg.user_id }),
                nickname: msg.nickname || msg.sender?.nickname || '',
                card: msg.sender?.card || '',
                role: msg.sender?.role || 'member'
              },
              message,
              raw_message: MsgToCQ(message)
            })
          } catch (e) {
            // 跳过无法转换的消息
          }
        }
      }
      ResponseData = {
        messages,
      };
    },

    // 设置表情表态
    set_reaction: async (params) => {
      /**
       * https://bot.q.qq.com/wiki/develop/api-v2/openapi/emoji/model.html#EmojiType
       * @param code 表情ID
       * @param type 表情类型 EmojiType
       */
      let seq = (await getMsg({ onebot_id: params.message_id }))?.seq
      if (!seq) {
        throw { message: "消息不存在", noLog: true };
      }
      let emojiType = params.type
      if (!emojiType) {
        emojiType = Number(params.code) >= 10000 ? 2 : 1
      }
      if (params.is_add) {
        await bot
          .pickGroup(params.group_id)
          .setReaction?.(seq, params.code, emojiType);
      } else {
        await bot
          .pickGroup(params.group_id)
          .delReaction?.(seq, params.code, emojiType);
      }
    },

    // NapCat/LLOneBot 扩展 — 消息表情回应
    // B12修复: 增加消息查找容错，支持直接使用message_id作为seq的回退
    // B13修复: 当 bot 通过 OneBotv11 adapter 连接时(如LLOneBot)，pickGroup 没有 setReaction，
    //         改为直接用 bot.sendApi 透传 set_msg_emoji_like 给上游协议端
    set_msg_emoji_like: async (params) => {
      let msg = await getMsg({ onebot_id: params.message_id })
      let seq = msg?.seq
      if (!seq) {
        // 回退: 尝试把 message_id 当作原始 message_id 查找
        msg = await getMsg({ message_id: params.message_id })
        seq = msg?.seq
      }
      if (!seq) {
        throw { message: `消息不存在: ${params.message_id}`, noLog: true }
      }
      let group_id = params.group_id || msg?.group_id
      if (!group_id) {
        throw { message: "缺少group_id", noLog: true }
      }
      let emoji_id = params.emoji_id || params.face_id || params.code
      // 自动判断表情类型: type 1 = QQ系统表情(小ID), type 2 = Unicode emoji(大ID如128513=😁, 10024=✨)
      let emojiType = params.type
      if (!emojiType) {
        emojiType = Number(emoji_id) >= 10000 ? 2 : 1
      }
      logger.debug(`[ws-plugin] set_msg_emoji_like: uin=${uin}, group_id=${group_id}, seq=${seq}, emoji_id=${emoji_id}, emojiType=${emojiType}, adapter=${bot?.adapter?.id || bot?.adapter?.name || 'unknown'}`)
      let group = bot.pickGroup(group_id)
      if (group?.setReaction) {
        // ICQQ 原生路径
        logger.debug(`[ws-plugin] set_msg_emoji_like: 使用ICQQ原生路径 setReaction`)
        try {
          if (params.is_set !== false) {
            await group.setReaction(seq, String(emoji_id), emojiType)
          } else {
            if (group.delReaction) {
              await group.delReaction(seq, String(emoji_id), emojiType)
            } else {
              throw { message: "当前协议端不支持取消消息表情回应(delReaction)", noLog: true }
            }
          }
        } catch (err) {
          logger.error(`[ws-plugin] set_msg_emoji_like ICQQ原生路径失败: ${err?.message || err}`)
          throw err
        }
      } else if (bot.sendApi) {
        // OneBotv11 adapter 路径 (LLOneBot/NapCat等)：透传原始API给上游协议端
        logger.debug(`[ws-plugin] set_msg_emoji_like: 使用sendApi透传路径`)
        // 使用原始 message_id 而非 ws-plugin 内部的 onebot_id
        const originalMsgId = msg?.message_id || params.message_id
        await bot.sendApi('set_msg_emoji_like', {
          message_id: originalMsgId,
          emoji_id: String(emoji_id),
          ...(params.is_set !== undefined ? { set: params.is_set } : {})
        })
      } else {
        throw { message: "当前协议端不支持消息表情回应(setReaction)", noLog: true }
      }
    },

    // --------------------------------------------------------
    // 图片
    // 图片相关 API
    // --------------------------------------------------------

    // 获取图片信息
    get_image: async ({ file }) => {
      let url
      if (file.startsWith('https://gchat.qpic.cn/gchatpic_new')) {
        url = file
      } else {
        const md5 = file.substring(0, 32)
        url = `https://gchat.qpic.cn/gchatpic_new/0/0-0-${md5.toUpperCase()}/0?term=2&is_origin=0`
      }
      const result = await fetch(url)
      const size = result?.headers?.size || 9999
      ResponseData = {
        size,
        filename: 'image',
        url
      }
    },
    // 检查是否可以发送图片
    can_send_image: async () => {
      ResponseData = {
        // 应该都能发吧
        yes: true
      }
    },
    // 图片 OCR
    // TODO ocr_image .ocr_image 没找到例子

    // --------------------------------------------------------
    // 语音
    // 语音相关 API
    // --------------------------------------------------------

    // 获取语音
    // B10修复: 实现get_record
    get_record: async (params) => {
      // ICQQ 通过 Group/Friend 的 getPttUrl 获取语音
      let url = params.file
      if (!url?.startsWith?.('http')) {
        // 尝试通过消息缓存获取
        let msg = await getMsg({ onebot_id: params.message_id })
        if (msg && msg.group_id) {
          url = await bot.pickGroup(msg.group_id)?.getPttUrl?.(params.file) || params.file
        }
      }
      ResponseData = {
        file: url || params.file
      }
    },
    // 检查是否可以发送语音
    can_send_record: async () => {
      ResponseData = {
        // 应该都能发吧
        yes: true
      }
    },

    // --------------------------------------------------------
    // 处理
    // 上报处理相关 API
    // --------------------------------------------------------

    // 处理加好友请求
    // B3修复: approve()返回void，不能作条件判断；拒绝时不应设备注
    set_friend_add_request: async params => {
      let ret = (await bot.getSystemMsg?.() || []).filter(i => i.request_type == 'friend' && i.flag == params.flag)
      if (ret.length > 0) {
        ret = ret[0]
        await ret.approve(params.approve)
        if (params.approve && params.remark) {
          await bot.pickFriend(ret.user_id)?.setRemark?.(params.remark)
        }
      }
    },
    // 处理加群请求／邀请
    set_group_add_request: async params => {
      let type = params.sub_type || params.type
      // 先尝试从系统消息中查找并approve
      let systemMsgs = await bot.getSystemMsg?.() || []
      let ret = systemMsgs.filter(i => {
        if (i.request_type != 'group') return false
        if (i.flag != params.flag) return false
        // type可能未传（如Sakura只传了flag+approve），此时不过滤sub_type
        if (type && i.sub_type != type) return false
        return true
      })
      if (ret.length > 0) {
        ret = ret[0]
        logger.debug(`[ws-plugin] set_group_add_request: 找到系统消息, flag=${params.flag}, approve=${params.approve}`)
        await ret.approve(params.approve)
        return
      }
      // fallback: 直接调用ICQQ原生方法
      if (bot.setGroupAddRequest) {
        logger.debug(`[ws-plugin] set_group_add_request: 系统消息未找到, 尝试ICQQ原生方法, flag=${params.flag}, approve=${params.approve}`)
        await bot.setGroupAddRequest(params.flag, params.approve, params.reason || '', params.block || false)
        return
      }
      logger.warn(`[ws-plugin] set_group_add_request: 无法处理, flag=${params.flag}, 系统消息中未找到匹配项且无原生方法可用`)
    },

    // --------------------------------------------------------
    // 群信息
    // 群信息相关 API
    // --------------------------------------------------------

    // 获取群信息
    get_group_info: async params => {
      try {
        const group = await bot.pickGroup(params.group_id)
        ResponseData = await group.info || await group.info?.() || await group.getInfo?.()
      } catch (error) {
        logger.warn(`[ws-plugin] get_group_info error group_id: ${params.group_id}`)
      } finally {
        if (!ResponseData) {
          ResponseData = {
            group_id: params.group_id,
            group_name: 'QQ群'
          }
        }
      }
      ResponseData.group_id = await getGroup_id({ group_id: params.group_id })
      if (ResponseData.group_name) {
        ResponseData.group_memo = ResponseData.group_name
      }
      if (ResponseData.create_time) {
        ResponseData.group_create_time = ResponseData.create_time
      }
      if (ResponseData.grade) {
        ResponseData.group_level = ResponseData.grade
      }
    },
    // 获取群列表
    get_group_list: async params => {
      let list = await bot.getGroupArray?.() || await bot.getGroupList?.() || []
      if (list instanceof Map) {
        list = Array.from(list.values())
      }
      ResponseData = []
      for (const i of list) {
        if (!i.group_id) continue
        i.group_id = await getGroup_id({ group_id: i.group_id })
        if (i.group_name) {
          i.group_memo = i.group_name
        }
        if (i.create_time) {
          i.group_create_time = i.create_time
        }
        if (i.grade) {
          i.group_level = i.grade
        }
        ResponseData.push(i)
      }
    },
    // 获取群成员信息
    get_group_member_info: async ({ group_id, user_id }) => {
      try {
        const group = await bot.pickGroup(group_id).pickMember(user_id)
        ResponseData = await group?.info || await group.info?.() || await group.getInfo?.() || await bot.getGroupMemberInfo?.(group_id, user_id)
      } catch (error) {
        logger.warn(`[ws-plugin] get_group_member_info error group_id: ${group_id} user_id: ${user_id}`)
      } finally {
        if (!ResponseData) {
          ResponseData = {
            group_id,
            user_id,
            nickname: adapter?.name || 'QQ用户',
            card: adapter?.name || 'QQ用户',
            sex: 'unknown',
            last_sent_time: 0,
            role: 'member'
          }
        }
      }
      ResponseData.group_id = await getGroup_id({ group_id })
      ResponseData.user_id = await getUser_id({ user_id })
      if (ResponseData.shutup_time) {
        ResponseData.shut_up_timestamp = ResponseData.shutup_time
      }
      if (!ResponseData.last_sent_time) {
        ResponseData.last_sent_time = Date.now()
      }
      if (!ResponseData.role) {
        ResponseData.role = 'member'
      }
      if (!ResponseData.card) {
        ResponseData.card = ResponseData.nickname || ResponseData.nick || 'QQ用户'
      }
      if (!ResponseData.nickname) {
        ResponseData.nickname = ResponseData.card || 'QQ用户'
      }
      if (!ResponseData.sex) {
        ResponseData.sex = 'unknown'
      }
    },
    // 获取群成员列表
    get_group_member_list: async (params) => {
      const group = await bot.pickGroup(params.group_id)
      let list = await group.getMemberMap?.() || await group.getMemberList?.() || []
      if (list instanceof Map) {
        list = Array.from(list.values())
      }
      const group_id = await getGroup_id({ group_id: params.group_id })
      for (const i in list) {
        list[i].group_id = group_id
        list[i].user_id = await getUser_id({ user_id: list[i].user_id })
        if (list[i].group_name) {
          list[i].group_memo = list[i].group_name
        }
        if (list[i].shutup_time) {
          list[i].shut_up_timestamp = list[i].shutup_time
        }
        if (!list[i].last_sent_time) {
          list[i].last_sent_time = Date.now()
        }
        if (!list[i].role) {
          list[i].role = 'member'
        }
        if (!list[i].sex) {
          list[i].sex = 'unknown'
        }
      }
      ResponseData = list
    },
    // 获取群荣誉信息
    // B9修复: 实现get_group_honor_info
    get_group_honor_info: async params => {
      // ICQQ 没有直接获取荣誉信息的API，返回基础结构
      ResponseData = {
        group_id: await getGroup_id({ group_id: params.group_id }),
        current_talkative: null,
        talkative_list: [],
        performer_list: [],
        legend_list: [],
        strong_newbie_list: [],
        emotion_list: []
      }
    },
    // 获取群系统消息
    get_group_system_msg: async params => {
      let invited_requests = []
      let join_requests = []
      for (const i of (await bot.getSystemMsg?.() || [])) {
        if (i.request_type == 'group') {
          switch (i.sub_type) {
            case 'add':
              join_requests.push({
                request_id: i.seq,
                requester_uin: i.user_id,
                requester_nick: i.nickname,
                message: i.comment,
                group_id: i.group_id,
                group_name: i.group_name,
                checked: false, // 好像这个只能获取没处理的
                actor: 0
              })
              break
            case 'invite':
              invited_requests.push({
                request_id: i.seq,
                invitor_uin: i.user_id,
                invitor_nick: i.nickname,
                group_id: i.group_id,
                group_name: i.group_name,
                checked: false, // 同上
                actor: 0
              })
              break
            default:
              break
          }
        }
      }
      ResponseData = {
        invited_requests,
        join_requests
      }
    },
    // 获取精华消息列表
    // B8修复: 添加TRSS环境支持
    get_essence_msg_list: async params => {
      ResponseData = []
      if (Version.isTrss) {
        // TRSS环境下尝试使用ICQQ原生方法
        try {
          let list = await bot.pickGroup(params.group_id)?.getEssenceMsg?.() || []
          for (const i of list) {
            ResponseData.push({
              sender_id: i.sender_uin || i.user_id,
              sender_nick: i.sender_nick || i.nickname || '',
              sender_time: i.sender_time || i.time || 0,
              operator_id: i.add_digest_uin || i.operator_id || 0,
              operator_nick: i.add_digest_nick || '',
              operator_time: i.add_digest_time || 0,
              message_id: i.msg_random || i.message_id || 0
            })
          }
        } catch (e) {
          logger.debug('[ws-plugin] TRSS环境获取精华消息失败', e.message)
        }
      } else {
        let is_end = false; let page_start = 0; let page_limit = 50
        while (!is_end) {
          let res = await fetch(`https://qun.qq.com/cgi-bin/group_digest/digest_list?bkn=${bot.bkn}&group_code=${params.group_id}&page_start=${page_start}&page_limit=${page_limit}`, {
            headers: {
              Cookie: bot.cookies['qun.qq.com']
            }
          }).then(r => r.json())
          if (res.retcode !== 0) return
          if (res.data?.is_end === false) {
            page_start++
          } else if (res.data?.is_end === true) {
            is_end = true
          }
          for (const i of res.data.msg_list) {
            ResponseData.push({
              sender_id: i.sender_uin,
              sender_nick: i.sender_nick,
              sender_time: i.sender_time,
              operator_id: i.add_digest_uin,
              operator_nick: i.add_digest_nick,
              operator_time: i.add_digest_time,
              message_id: i.msg_random
            })
          }
        }
      }
    },
    // 获取群 @全体成员 剩余次数
    // B6修复: getAtAllRemainder是async，需要await
    get_group_at_all_remain: async params => {
      let ret = await bot.pickGroup(params.group_id)
      let remainder = await ret.getAtAllRemainder?.() || 0
      ResponseData = {
        can_at_all: ret?.is_admin || ret?.is_owner || false,
        remain_at_all_count_for_group: remainder,
        remain_at_all_count_for_uin: remainder
      }
    },

    // --------------------------------------------------------
    // 群设置
    // 群设置相关 API
    // --------------------------------------------------------

    // 设置群名
    set_group_name: async params => {
      await bot.setGroupName?.(params.group_id, params.group_name) || await bot.pickGroup(params.group_id)?.setName?.(params.group_name)
    },
    // 设置群头像
    set_group_portrait: async params => {
      await bot.setGroupPortrait?.(params.group_id, params.file) || await bot.pickGroup(params.group_id)?.setAvatar?.(params.file)
    },
    // 设置群管理员
    set_group_admin: async params => {
      await bot.setGroupAdmin?.(params.group_id, params.user_id, params.enable) || await bot.pickGroup(params.group_id)?.setAdmin?.(params.user_id, params.enable)
    },
    // 设置群名片 ( 群备注 )
    set_group_card: async params => {
      await bot.setGroupCard?.(params.group_id, params.user_id, params.card) || await bot.pickGroup(params.group_id)?.setCard?.(params.user_id, params.card)
    },
    // 设置群组专属头衔
    set_group_special_title: async params => {
      await bot.setGroupSpecialTitle?.(params.group_id, params.user_id, params.special_title, params.duration || -1) || await bot.pickGroup(params.group_id)?.setTitle?.(params.user_id, params.special_title, params.duration || -1)
    },

    // --------------------------------------------------------
    // 群操作
    // 群操作相关 API
    // --------------------------------------------------------

    // 群单人禁言
    // B2修复: OneBot v11标准duration默认值1800秒
    set_group_ban: async (params) => {
      const duration = params.duration ?? 1800
      await bot.setGroupBan?.(params.group_id, params.user_id, duration) || await bot.pickGroup(params.group_id)?.muteMember?.(params.user_id, duration)
    },
    // 群全员禁言
    set_group_whole_ban: async params => {
      await bot.setGroupWholeBan?.(params.group_id, params.enable) || await bot.pickGroup(params.group_id)?.muteAll?.(params.enable)
    },
    // 群匿名用户禁言
    // B4修复: 添加ICQQ muteAnony fallback
    set_group_anonymous_ban: async params => {
      let flag = params.anonymous?.flag || params.anonymous_flag || params.flag
      const duration = params.duration ?? 1800
      await bot.setGroupAnonymousBan?.(params.group_id, flag, duration) || await bot.pickGroup(params.group_id)?.muteAnony?.(flag, duration)
    },
    // 设置精华消息
    set_essence_msg: async params => {
      let msg = (await getMsg({ onebot_id: params.message_id }))
      if (msg) await bot.setEssenceMessage?.(msg.message_id) || await bot.pickGroup(params.group_id)?.addEssence?.(msg.seq, msg.rand)
    },
    // 移出精华消息
    delete_essence_msg: async params => {
      let msg = (await getMsg({ onebot_id: params.message_id }))
      if (msg) await bot.removeEssenceMessage?.(msg.message_id) || await bot.pickGroup(params.group_id)?.removeEssence?.(msg.seq, msg.rand)
    },
    // 群打卡
    send_group_sign: async params => {
      await bot.sendGroupSign?.(params.group_id) || await bot.pickGroup(params.group_id)?.sign?.()
    },
    // 群设置匿名
    // B5修复: 添加ICQQ allowAnony fallback
    set_group_anonymous: async params => {
      await bot.setGroupAnonymous?.(params.group_id, params.enable) || await bot.pickGroup(params.group_id)?.allowAnony?.(params.enable)
    },
    // 发送群公告
    // B7修复: 添加TRSS环境支持，使用ICQQ announce()方法
    _send_group_notice: async params => {
      if (Version.isTrss) {
        await bot.sendGroupNotice?.(params.group_id, params.content) || await bot.pickGroup(params.group_id)?.announce?.(params.content)
      } else {
        await fetch(`https://web.qun.qq.com/cgi-bin/announce/add_qun_notice?bkn=${bot.bkn}`, {
          method: 'POST',
          body: `qid=${params.group_id}&bkn=${bot.bkn}&text=${params.content}&pinned=0&type=1&settings={"is_show_edit_card":1,"tip_window_type":1,"confirm_required":1}`,
          headers: {
            Cookie: bot.cookies['qun.qq.com']
          }
        })
      }
    },
    // 获取群公告 TODO
    _get_group_notice: async params => {
      if (!Version.isTrss) {
        let res = await fetch(`https://web.qun.qq.com/cgi-bin/announce/get_t_list?bkn=${bot.bkn}&qid=${params.group_id}&ft=23&s=-1&n=20`, {
          headers: {
            Cookie: bot.cookies['qun.qq.com']
          }
        }).then(r => r.json())
        ResponseData = []
        if (res.feeds) {
          for (const i of res.feeds) {
            let item = {
              sender_id: i.u,
              publish_time: i.pubt,
              message: {
                text: i.msg.text
              },
              images: []
            }
            if (i.pics) {
              for (const pic of i.pics) {
                item.images.push({
                  height: pic.h,
                  width: pic.w,
                  id: pic.id
                })
              }
            }
            ResponseData.push(item)
          }
        }
      }
    },
    // 群组踢人
    set_group_kick: async params => {
      await bot.setGroupKick?.(params.group_id, params.user_id, params.reject_add_request || false) || await bot.pickGroup(params.group_id)?.kickMember?.(params.user_id, params.reject_add_request || false)
    },
    // 退出群组
    set_group_leave: async params => {
      await bot.setGroupLeave?.(params.group_id) || await bot.pickGroup(params.group_id)?.quit?.()
    },

    // --------------------------------------------------------
    // 文件
    // --------------------------------------------------------

    // 上传群文件
    upload_group_file: async params => {
      await bot.pickGroup(params.group_id).fs?.upload?.(params.file, params.folder || '/', params.name)
    },
    // 删除群文件
    delete_group_file: async params => {
      await bot.pickGroup(params.group_id).fs?.rm?.(params.file_id)
    },
    // 创建群文件文件夹
    create_group_file_folder: async params => {
      await bot.pickGroup(params.group_id).fs?.mkdir?.(params.name)
    },
    // 删除群文件文件夹
    delete_group_folder: async params => {
      await bot.pickGroup(params.group_id).fs?.rm?.(params.folder_id)
    },
    // 获取群文件系统信息
    get_group_file_system_info: async params => {
      let ret = await bot.pickGroup(params.group_id).fs?.df?.()
      ResponseData = {
        file_count: ret?.file_count || 0,
        limit_count: ret?.max_file_count || 0,
        used_space: ret?.used || 0,
        total_space: ret?.total || 0
      }
    },
    // 获取群根目录文件列表
    get_group_root_files: async (params) => {
      let list = await bot.pickGroup(params.group_id).fs?.ls?.()
      let files = []
      let folders = []
      let nickname = {}
      if (Array.isArray(list) && list.length > 0) {
        for (const item of list) {
          let user_id = item.user_id
          if (!nickname[user_id]) {
            nickname[user_id] = (await bot.getStrangerInfo(item.user_id)).nickname
          }
          if (item.is_dir) {
            folders.push({
              group_id: params.group_id,
              folder_id: item.fid,
              folder_name: item.name,
              create_time: item.create_time,
              creator: item.user_id,
              creator_name: nickname[user_id],
              total_file_count: item.file_count
            })
          } else {
            files.push({
              group_id: params.group_id,
              file_id: item.fid,
              file_name: item.name,
              busid: item.busid,
              file_size: item.size,
              upload_time: item.create_time,
              dead_time: item.duration,
              modify_time: item.create_time,
              download_times: item.download_times,
              uploader: item.user_id,
              uploader_name: nickname[user_id]
            })
          }
        }
      }
      ResponseData = {
        files,
        folders
      }
    },
    // 获取群子目录文件列表
    get_group_files_by_folder: async params => {
      let list = await bot.pickGroup(params.group_id).fs?.ls?.(params.folder_id)
      let files = []
      let folders = []
      let nickname = {}
      if (Array.isArray(list) && list.length > 0) {
        for (const item of list) {
          let user_id = item.user_id
          if (!nickname[user_id]) {
            nickname[user_id] = (await bot.getStrangerInfo(item.user_id)).nickname
          }
          if (item.is_dir) {
            folders.push({
              group_id: params.group_id,
              folder_id: item.fid,
              folder_name: item.name,
              create_time: item.create_time,
              creator: item.user_id,
              creator_name: nickname[user_id],
              total_file_count: item.file_count
            })
          } else {
            files.push({
              group_id: params.group_id,
              file_id: item.fid,
              file_name: item.name,
              busid: item.busid,
              file_size: item.size,
              upload_time: item.create_time,
              dead_time: item.duration,
              modify_time: item.create_time,
              download_times: item.download_times,
              uploader: item.user_id,
              uploader_name: nickname[user_id]
            })
          }
        }
      }
      ResponseData = {
        files,
        folders
      }
    },
    // 获取群文件资源链接
    get_group_file_url: async params => {
      let file = await bot.pickGroup(params.group_id).fs?.download?.(params.file_id)
      ResponseData = {
        url: file?.url
      }
    },
    // 上传私聊文件
    upload_private_file: async params => {
      await bot.pickFriend(params.user_id).sendFile?.(params.file, params.name)
    },

    // --------------------------------------------------------
    // Go-CqHttp 相关
    // 获取 Cookies
    // --------------------------------------------------------

    // 获取 Cookies
    get_cookies: async params => {
      ResponseData = {
        cookies: await bot.getCookies?.(params.domain || null)
      }
    },
    // 获取 CSRF Token
    get_csrf_token: async params => {
      ResponseData = {
        token: await bot.getCsrfToken?.()
      }
    },
    // 获取 QQ 相关接口凭证
    get_credentials: async params => {
      ResponseData = {
        cookies: await bot.getCookies?.(params.domain || null),
        token: await bot.getCsrfToken?.()
      }
    },
    // 获取版本信息
    get_version_info: async params => {
      ResponseData = {
        app_name: 'ws-plugin',
        app_version: Version.version,
        protocol_version: 'v11'
      }
    },
    // 获取状态
    get_status: async params => {
      ResponseData = {
        online: bot.isOnline?.() || true,
        good: bot.isOnline?.() || true,
        app_initialized: true,
        app_enabled: true,
        plugins_good: true,
        app_good: true,
        stat: {
          packet_receivend: bot.stat?.recv_pkt_cnt || 0,
          packet_send: bot.stat?.sent_pkt_cnt || 0,
          packet_lost: bot.stat?.lost_pkt_cnt || 0,
          message_received: bot.stat?.recv_msg_cnt || 0,
          message_send: bot.stat?.sent_msg_cnt || 0,
          disconnect_times: 0,
          lost_times: bot.stat?.lost_times || 0,
          last_message_time: getLatestMsg()?.time || 0
        }
      }
    },
    // 重启 Go-CqHttp
    // set_restart 什么?已经没了?
    // 清理缓存
    clean_cache: async params => {
      await bot.cleanCache?.()
    },
    // 重载事件过滤器
    // TODO reload_event_filter 这是啥
    // 下载文件到缓存目录
    download_file: async params => {
      // 暂不支持 headers 自定义请求头
      const file = join(TMP_DIR, randomUUID({ disableEntropyCache: true }))
      if (await common.downFile(params.url, file)) {
        ResponseData = {
          file
        }
      }
    },
    // 检查链接安全性
    // TODO check_url_safely 不会
    // 获取中文分词 ( 隐藏 API )
    // .get_word_slices
    // 对事件执行快速操作 ( 隐藏 API )
    '.handle_quick_operation': async ({ context, operation }) => {
      if (adapter) {
        if (context.user_id != uin) {
          context.user_id = await getUser_id({ custom: context.user_id, like: adapter.user_like })
        }
        context.group_id = await getGroup_id({ custom: context.group_id, like: adapter.group_like })
      }
      switch (context.post_type) {
        case 'message':
          switch (context.message_type) {
            case 'group':
              if (operation.reply) {
                if (!operation.auto_escape) {
                  operation.reply = CQToMsg(operation.reply)
                }
                if (!Array.isArray(operation.reply)) {
                  operation.reply = [{ type: 'text', data: { text: operation.reply } }]
                }
                let { sendMsg, quote } = await makeSendMsg({ message: operation.reply }, uin, adapter)
                if (operation.at_sender) {
                  sendMsg.unshift(segment.at(context.user_id))
                }
                await bot.pickGroup?.(context.group_id).sendMsg?.(sendMsg, quote)
              }
              if (operation.delete) {
                let msg = await getMsg({ onebot_id: context.message_id })
                if (msg) {
                  await publicApi.delete_msg({ message_id: msg.message_id })
                  // await bot.deleteMsg?.(msg.message_id)
                }
              }
              if (operation.kick) {
                await publicApi.set_group_kick({ group_id: context.group_id, user_id: context.user_id })
                // await bot.setGroupKick?.(context.group_id, context.user_id, true)
              }
              if (operation.ban) {
                await publicApi.set_group_ban({ group_id: context.group_id, user_id: context.user_id, duration: context.ban_duration })
                // await bot.setGroupBan?.(context.group_id, context.user_id, context.ban_duration)
              }
              break
            case 'private':
              if (operation.reply) {
                if (operation.auto_escape) {
                  operation.reply = CQToMsg(operation.reply)
                }
                if (!Array.isArray(operation.reply)) {
                  operation.reply = [{ type: 'text', data: { text: operation.reply } }]
                }
                let { sendMsg, quote } = await makeSendMsg({ message: operation.reply }, uin, adapter)
                await bot.pickFriend?.(context.user_id).sendMsg?.(sendMsg, quote)
              }
              break
          }
          break
        case 'request':
          switch (context.request_type) {
            case 'friend':
              if (operation.approve) {
                let ret = (await bot.getSystemMsg?.() || []).filter(i => i.request_type == 'friend' && i.flag == context.flag)
                if (ret.length > 0) {
                  ret = ret[0]
                  if (ret.approve(operation.approve)) {
                    if (operation.remark) {
                      bot.pickFriend(ret.user_id).setRemark(operation.remark)
                    }
                  }
                }
              }
              break
            case 'group': {
              let type = context.sub_type
              let systemMsgs = await bot.getSystemMsg?.() || []
              let ret = systemMsgs.filter(i => {
                if (i.request_type != 'group') return false
                if (i.flag != context.flag) return false
                if (type && i.sub_type != type) return false
                return true
              })
              if (ret.length > 0) {
                ret = ret[0]
                await ret.approve(operation.approve)
              } else if (bot.setGroupAddRequest) {
                await bot.setGroupAddRequest(context.flag, operation.approve, '', false)
              }
            }
          }
      }
    },

    send_guild_channel_msg: async params => {
      let { sendMsg } = await makeSendMsg(params, uin, adapter)
      const msg = getLatestMsg(params.group_id)
      if (msg) {
        sendMsg.unshift({
          type: 'reply',
          data: {
            id: msg.message_id
          }
        })
      }
      await bot.pickGroup?.(`qg_${params.guild_id}-${params.channel_id}`)?.sendMsg?.(sendMsg)
      logger.info(`[ws-plugin] 连接名字:${name} 处理完成`)
    },
    get_guild_service_profile: async params => {
      ResponseData = {
        avatar_url: bot.avatar,
        nickname: bot.nickname,
        tiny_id: bot.tiny_id
      }
    },
    get_guild_list: async params => {
      ResponseData = await bot.getGuildList?.()
    },
    get_guild_channel_list: async params => {

    }

  }
  api = api?.replace(/_async$/, '')
  if (typeof publicApi[api] === 'function') {
    await publicApi[api](params)
    if (sendRet) {
      switch (adapter?.name) {
        case 'QQ频道Bot':
          sendRet = {
            message_id: sendRet.message_id?.[0] || Date.now()
          }
          break

        default:
          break
      }
      const onebot_id = Math.floor(Math.random() * Math.pow(2, 32)) | 0
      ResponseData = {
        ...sendRet,
        message_id: onebot_id
      }
      if (sendRet.message_id) {
        setMsg({
          message_id: sendRet.message_id,
          time: sendRet.time,
          seq: sendRet.seq,
          rand: sendRet.rand,
          user_id: params.user_id,
          group_id: params.group_id,
          onebot_id
        })
      }
    }
    const del = ['bot', 'group', 'friend', 'member', 'guild', 'channel']
    if (ResponseData) {
      for (const i of del) {
        if (ResponseData[i] && typeof ResponseData[i] != 'boolean') {
          delete ResponseData[i]
        }
      }
    }
    return ResponseData
  } else {
    logger.warn(`[ws-plugin] 未适配的api: ${api}`)
  }
}

export {
  getApiData
}

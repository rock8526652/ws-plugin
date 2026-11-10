/** Sakura 支持直接发送字符串、单个消息段及混合数组，统一为 OB11 消息段。 */
export function normalizeSendSegments(message) {
  return (Array.isArray(message) ? message : [message]).map(item => {
    if (typeof item === 'string') return { type: 'text', data: { text: item } }
    if (!item || typeof item !== 'object' || !item.type) throw new Error('无效的 OneBot 消息段')
    const data = { ...(item.data || {}) }
    if (item.type === 'image' && !data.file && data.url) data.file = data.url
    return { ...item, data }
  })
}

/**
 * 记录合并转发 resid / 文件 fid 的来源会话。
 * ICQQ 下载合并转发、文件时需要区分群聊与私聊，而 OB11 的 get_forward_msg / get_file 只传 id。
 */
const resourceContext = new Map()
const RESOURCE_CONTEXT_LIMIT = 2000

export function rememberResource (id, ctx = {}) {
  if (id === undefined || id === null || id === '') return
  const key = String(id)
  resourceContext.delete(key)
  resourceContext.set(key, {
    group_id: ctx.group_id ? Number(ctx.group_id) || ctx.group_id : undefined,
    user_id: ctx.user_id ? Number(ctx.user_id) || ctx.user_id : undefined,
    ...ctx.extra
  })
  if (resourceContext.size > RESOURCE_CONTEXT_LIMIT) {
    resourceContext.delete(resourceContext.keys().next().value)
  }
}

export function getResourceContext (id) {
  if (id === undefined || id === null) return null
  return resourceContext.get(String(id)) || null
}

/**
 * 群消息 seq → onebot_id 索引。
 * ICQQ 的表情回应事件只给 seq，redis 存储模式无法按 seq 反查，故在内存中额外记录。
 */
const groupSeqIndex = new Map()
const GROUP_SEQ_LIMIT = 5000

export function rememberGroupSeq (group_id, seq, onebot_id) {
  if (!group_id || seq == null || onebot_id == null) return
  const key = `${group_id}:${seq}`
  groupSeqIndex.delete(key)
  groupSeqIndex.set(key, onebot_id)
  if (groupSeqIndex.size > GROUP_SEQ_LIMIT) {
    groupSeqIndex.delete(groupSeqIndex.keys().next().value)
  }
}

export function findOnebotIdBySeq (group_id, seq) {
  if (!group_id || seq == null) return null
  return groupSeqIndex.get(`${group_id}:${seq}`) ?? null
}

/** 判断 OB11 图片段是否为表情包（sub_type / subType 为 1） */
export function isStickerSegment (data = {}) {
  return Number(data.sub_type ?? data.subType) === 1 || data.asface === true
}

/** 从 json / xml 卡片中提取合并转发 resid */
export function extractForwardResid (type, data) {
  try {
    if (type === 'xml') {
      return /m_resid="(.*?)"/.exec(String(data))?.[1] || null
    }
    const json = typeof data === 'object' ? data : JSON.parse(String(data))
    if (json?.app === 'com.tencent.multimsg') return json.meta?.detail?.resid || null
  } catch { /* 非合并转发卡片 */ }
  return null
}

/** 云崽不同协议取消息入口不同，引用回复和 get_msg 共享同一条回退链。 */
export async function resolveQuotedMessage(bot, mapping) {
  if (!mapping) return null
  const contact = () => mapping.group_id ? bot.pickGroup?.(mapping.group_id) : bot.pickFriend?.(mapping.user_id)
  const attempts = [
    () => bot.getMsg?.(mapping.message_id),
    () => contact()?.getMsg?.(mapping.message_id),
    () => contact()?.getChatHistory?.(mapping.group_id ? mapping.seq : mapping.time, 1)
  ]
  for (const attempt of attempts) {
    try {
      let result = await attempt()
      if (Array.isArray(result)) result = result.find(item =>
        (mapping.message_id != null && String(item.message_id) === String(mapping.message_id)) ||
        (mapping.seq != null && String(item.seq) === String(mapping.seq)))
      if (result?.message) return result
    } catch { /* 当前协议未实现时继续尝试联系人的接口 */ }
  }
  return null
}

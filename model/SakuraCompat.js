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

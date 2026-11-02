/**
 * CQ码特殊字符反转义
 * @param {string} str
 */
function unescapeCQ (str) {
  return str
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&')
}

/**
 * CQ码特殊字符转义
 * @param {string} str
 * @param {boolean} insideCQ 是否在CQ码内部（需要额外转义逗号）
 */
function escapeCQ (str, insideCQ = false) {
  str = String(str)
    .replace(/&/g, '&amp;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
  if (insideCQ) {
    str = str.replace(/,/g, '&#44;')
  }
  return str
}

/**
 * cq码转换Msg
 * @param {*} cq
 */
function CQToMsg (cq) {
  let msg = []
  let matches = cq.matchAll(/(\[CQ:(.*?),(.*?)\]|.)/gs)
  let text = ''
  for (const match of matches) {
    if (match[2]) {
      if (text) {
        msg.push({
          type: 'text',
          data: {
            text: unescapeCQ(text)
          }
        })
        text = ''
      }
      let type = match[2]
      let data = {}
      let pairs = match[3].split(',')
      for (const pair of pairs) {
        // 修复D1: 用indexOf只在第一个=号处分割，保留value中的=
        let idx = pair.indexOf('=')
        if (idx === -1) continue
        let key = pair.substring(0, idx)
        let value = unescapeCQ(pair.substring(idx + 1))
        data[key] = value
      }
      msg.push({ type, data })
    } else {
      text += match[0]
    }
  }
  if (text) {
    msg.push({
      type: 'text',
      data: {
        text: unescapeCQ(text)
      }
    })
  }
  return msg
}

/**
 * msg转换cq码
 * @param {*} msg
 * @returns
 */
function MsgToCQ (msg) {
  let cq = ''
  for (const item of msg) {
    if (item.type === 'text') {
      cq += escapeCQ(item.data.text)
    } else {
      // 修复D3: 处理value为对象的情况，转为JSON字符串
      let data = Object.entries(item.data).map(([key, value]) => {
        if (value === null || value === undefined) return `${key}=`
        if (typeof value === 'object') value = JSON.stringify(value)
        return `${key}=${escapeCQ(String(value), true)}`
      }).join(',')
      cq += `[CQ:${item.type},${data}]`
    }
  }
  return cq
}

export {
  CQToMsg,
  MsgToCQ
}

import { Config } from '../components/index.js'
/**
 * 生命周期
 * @param {*} socket 
 */
function lifecycle(uin) {
    return JSON.stringify({
        meta_event_type: 'lifecycle',
        post_type: 'meta_event',
        self_id: uin,
        sub_type: 'connect',
        time: Date.parse(new Date()) / 1000
    })
}

/**
 * 心跳
 * @param {*} socket 
 */
function heartbeat(uin) {
    const bot = Bot[uin] || Bot
    const status = {
        app_good: true,
        online: bot?.isOnline?.() ?? true,
        good: true,
        stat: {
            packet_received: 0,
            packet_sent: 0,
            packet_lost: 0,
            message_received: bot?.stat?.recv_msg_cnt ?? 0,
            message_sent: bot?.stat?.sent_msg_cnt ?? 0,
            disconnect_times: 0,
            lost_times: 0,
            last_message_time: bot?.stat?.last_recv_msg_time ?? 0
        }
    }
    return JSON.stringify({
        time: Date.parse(new Date()) / 1000,
        self_id: uin,
        post_type: 'meta_event',
        meta_event_type: 'heartbeat',
        status,
        interval: Config.heartbeatInterval * 1000
    })
}

export {
    lifecycle,
    heartbeat
}
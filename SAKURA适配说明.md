# ws-plugin 的 Sakura OB11 适配

连接方向：云崽中的 ws-plugin → Sakura 的 OneBot v11 反向监听。
本版本仍然运行在云崽，不要安装进 Sakura 的 plugins 目录。

上游：[rock8526652/ws-plugin](https://github.com/rock8526652/ws-plugin)
适配基线：`cf0722a6d094685483cfa7b6ca85ebfd8ac9221b`。

## 安装

1. 在云崽端备份现有 ws-plugin。
2. 将覆盖包解压到云崽的 `plugins` 目录，合并其中的 `ws-plugin` 目录。
3. 保留原来的 `config/config`、数据库和依赖；本次没有新增依赖。
4. 在云崽端检查 `plugins/ws-plugin/config/config/ws-config.yaml`：连接类型为 `1`，地址指向 Sakura 已启用的反向 WebSocket 监听端口，上报格式为数组 `messagePostFormat: 2`。若连接显式配置了 `accessKey: Token`，将该连接改为 `accessKey: Bearer`；两端 accessToken 必须一致。
5. 重启云崽使插件代码生效。Sakura 无须更换代码。

连接配置示例（将账号、地址和令牌替换为实际值）：

```yaml
messagePostFormat: 2
servers:
  - name: Sakura
    address: ws://Sakura所在主机:3002
    type: 1
    uin: 123456789
    accessKey: Bearer
    accessToken: 两端一致的令牌
    reconnectInterval: 5
    maxReconnectAttempts: 0
```

## 修改内容

- 接受 Sakura 发来的文字与消息段混合数组、单个消息段，避免读取 `i.data.file` 时抛错。
- 图片支持以 `url` 补齐 `file`，支持 Buffer 转 Base64，保留 HTTP URL 的百分号转义，避免解码破坏图片链接。
- 引用回复与 `get_msg` 共用原消息查询逻辑：依次尝试 bot、联系人、聊天历史接口；历史结果检查消息 ID 或 seq，避免引用错消息。
- 消息上报和发送 API 返回前等待 ID 映射写入，减少紧接着回复、引用、撤回时查不到映射的问题。
- 转发内消息转换继续传递当前账号和适配器，避免多账号时回落到错误的 Bot。
- 默认鉴权前缀采用 Sakura 可识别的 `Bearer`，显式指定其他前缀的连接仍保留其设置。
- API 错误同时返回 `message` 字段，让 Sakura 的现有错误日志显示具体原因。

## 验证

```bash
node --experimental-vm-modules --test scripts/sakura-compat.test.mjs
```

共 6 项测试，包括真实发送转换函数、Base64/Buffer 图片、联系人接口引用回退、映射写入时序、真实 WebSocket 收发，以及连接未修改的 Sakura OB11 反向服务。云崽账号与 QQ 协议端使用测试替身，因此这些结果不等同于真实 QQ 发图与引用已验收。最后一项在旁边没有 Sakura 源码时自动跳过。

安装后请实际验证一次群内文字回复、图片回复和引用回复。
若云崽与 Sakura 分处两台机器，Sakura 发送的图片必须是云崽可读取的 URL、Base64，或双方已共享的文件路径。仅存在于 Sakura 本机的绝对路径不能由云崽直接读取。

覆盖包只含 4 个运行时代码文件、测试脚本与本说明，不含配置、令牌、数据库或依赖。源码目录内上游附带的配置不应覆盖到现有云崽安装。

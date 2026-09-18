# ADR 0004：Live 会话改用 Responses 委派，服务端只执行工具

- 日期：2026-09-18
- 状态：已实现，待生产真机验证
- 取代：[服务端语音控制](../server-voice-control.md) 中"后端逐片段调用 luna 判断意图"的做法

## 背景

服务端语音控制上线后，用户反馈介入很慢。用生产账本和本地真模型基准复现：每次开口触发 3 到 7 次串行的 gpt-5.6-luna 调用，首个识别片段后 160ms 就发起，文本一变就作废重来，真正生效的那次在用户说完最后一个字之后才开始；答案生成完再交给 gpt-live-1 用 `commentary.append` 复述一遍。纯提问从说完到最终决策 5.4 秒，英文混合句 7.2 秒，还没算 Live 复述。降低 reasoning effort 只改善零点几秒。

GPT-Live 文档把逐片段处理定位为"投机查询、护栏、界面更新"，用应用逻辑或轻量模型；把带推理和工具的后台接入定位为 **Responses 委派**：Live 自己判断轮次并把对话交给配置好的 Responses 模型，连接预热、状态复用由它管，后台事件和函数调用经 `response.event` 回到应用，应用用 `response.item.create` 加 `response.create` 交回结果，Live 直接把后台输出说出来。

## 决策

1. 服务端语音控制的会话以 `delegation.type = "responses"` 创建：后台模型 luna，指令为对话政策加一段随播放位置刷新的"已听文稿窗口"，工具为 control_podcast、resume_podcast、ignore_input、wait_for_input、get_passage、search_podcast，reasoning low，priority。Live 指令改为"你不知道节目内容，任何问题和播放请求必须委派"；主播人设只留给后台模型。旧的"扮演主播"Live 指令会让它直接自答、不委派。
2. `LiveSupervisor`（Workers）与本地 Node 服务里的 `LiveControl` 改为持有 `LiveDelegation`：从 sideband 收 `session.delegation.created` 与 `response.event`，节目检索在服务端算，播放器操作经既有 NDJSON 推给浏览器、等执行回报后再作为函数结果交回，忽略/等待直接回报。播放位置换段时用 `session.update` 刷新后台指令，至多每 3 秒一次。后台每次响应的 usage 从 `response.completed` 写入问答账本。
3. 浏览器新增两种控制事件：`engage`（后台开始回答：硬让位、打开回答音频窗口、记录用户话语，Live 自己说答案，前端不再 append commentary）与 `answered`（后台答案文本与来源，仅用于引用与诊断）。既有 `decision` 事件继续承载播放器操作、恢复、忽略与等待。
4. 保留一个本地快速暂停：当前话语只是"等一下 / wait / hold on / pause"之类时立即推暂停，后台随后的相同 pause 调用复用该结果，不暂停两次。这是文档所说的片段护栏用法，替代此前放弃委派的原因（Live 对短控制词不委派）。
5. `LiveIntent`、`LiveConversation` 及其测试退役。文字提问与按住说话仍走 `/question` 加 `commentary.append`，委派会话同样接受这两种 append。

## 验证

- 真服务探针 `scripts/live-delegation-probe.ts`（WebSocket 主连接）与本地的 aiortc 探针（WebRTC 主连接 + sideband）：九次会话全部委派、工具选择正确；说完到答案开口 1.2 到 2.7 秒，暂停 1.3 秒；sideband 收到全部后台事件，工具结果从 sideband 交回后后台继续，`session.update` 从 sideband 刷新指令成功。英文提问中文节目的跨语言检索会多绕两轮，后台指令已要求用节目语言检索。
- `npm test`、`npm run test:cloudflare`（含重写的 sideband 用例：委派配置、工具回报等待执行回报、engage/answered、账本）、`npm run check`、Playwright voice-remote 18 项与 player 4 项通过。player.spec 的语音用例此前未随 #17/#20 更新，本次一并修正为字幕随可听输出释放、静音后保持等待。
- 未验证：生产环境真人麦克风端到端；Live 对中文短控制词的委派稳定性；控制类工具后 Live 偶尔的口头确认（后台指令已要求控制类不产生文本）。

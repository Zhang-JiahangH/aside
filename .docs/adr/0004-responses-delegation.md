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

## 补充：转写到了，但没有委派

生产 sideband 曾收到 `session.input_transcript.delta`，直到会话关闭仍没有 `session.delegation.created` 或后台事件。因此不能只靠 Live 自己决定是否启动后台。

`LiveResponseTrigger` 在有效转写片段后合并 600ms；连续说话时最多等 1200ms 就通过 sideband 发送 `response.create`，请求会话中已经配置的同一个 Responses 后台。正常委派会取消这个计时器，后台运行期间不另开请求；工具轮次完成后才释放等待中的新话语。`ignore_input` / `wait_for_input` 之后只有新词到达才重新判断，不循环请求。播放器手动操作、断开会话都会取消待处理工作，旧委派的迟到文本和指令不再影响播放器，但使用量仍记账。

这只是保证后台有机会判断，不直接决定回应或放行音频：旁人聊天仍由 `ignore_input` 忽略，后台输出答案或查询文稿才 `engage`，播放器工具仍经 NDJSON 和执行回报。请求被拒绝、10 秒没有开始事件、或后台明确失败都会输出错误，避免一直停在“听到了但没反馈”。日志新增 `Aside voice delegation fallback requested`，包含事件 ID 和字符数，不记录用户原话。

接口依据：[Live sideband `response.create`](https://developers.openai.com/api/reference/resources/live/sideband-websocket#response.create) 支持主动请求 Responses 后台响应，以及继续工具调用。此次回归用确定性工具事件和静音合成 WebRTC 覆盖不委派、正常委派竞争、等待更多输入、忽略旁人、播放控制及对话历史；真实供应商和 iPad 麦克风效果仍需上线后验证。

### 显式请求必须带上转写输入

后续《狂人日记》生产日志显示兜底已发出、后台也已启动，但多轮均调用 `wait_for_input`。上一版只发 `response.create`，没有把应用收到的转写显式传给后台。真实 GPT-Live 对照中，去掉转写输入时后台返回“没有新的用户请求”；先提交相同问题的转写后，后台返回了《狂人日记》的解释。

兜底现在先用 `response.item.create` 发送 `role: "user"` 的 `voiceInput` 快照，再发送 `response.create`。快照包含累计转写、话语 ID、开口时播放器状态及当前可听回答/播放状态。相同话语 ID 表示片段修订，仍按环境语音判断，不视为显式文字提问，也不重复已执行动作。正常 Live 委派不额外注入。输入提交被拒绝时明确报错。接口依据：[向后台队列添加用户输入](https://developers.openai.com/api/docs/guides/live-delegation#accept-typed-input)。

回归模型只能从实际发出的 `response.item.create` 读取兜底输入；不能再从测试的转写变量直接取得问题，否则会掩盖“应用听到了、模型没收到”的缺陷。

真实供应商验证使用临时鉴权 Cloudflare 预览，密钥留在 Worker 内，以 GPT-Live 主 WebSocket 执行生产协调器：完整问题得到中文解释，旁人聊天调用 `ignore_input`，调速调用 `control_podcast`。另将合成中文音频按实时节奏输入，实际收到转写与非静音中文回复；该轮较早的片段触发了一句澄清，并非直接内容解释。输出只测量、不播放。此探针未覆盖 iPad 麦克风与生产 sideband 传输；后者由线上事件及 Cloudflare 集成测试覆盖。

### 插话先停止可听输出，再判断新话语

模型已经在出声时，本地语音检测一旦确认用户开口，播放器立即关闭回答音频窗口、清空剩余音频及未播放字幕，并通知 Live 停止旧回答。已听到的前缀保留，`assistant.state` 上报为 `interrupted`。此操作不等待转写、后台判断或 NDJSON，也不修改播放器 revision，避免使正在到达的新话语决策失效。后端仍负责决定忽略、等待、回答或控制播放。

插话期间丢弃旧输出；用户说完后重新准备音频缓冲，以保留下一条获准回答的开头。旧回答的迟到完成通知不能重新打开音频。没有实际出声的排队回答、查询中的安静间隙，以及单独的识别通知仍不会触发本地打断。后台忽略插话时保持安静，节目只在明确续播指令后继续。

回归覆盖本地麦克风帧先于任何新转写使实际音频队列停止、已听历史保留、下一条回答提前到达的前缀，以及首次连接通过 HTTP 回答的路径。浏览器使用静音合成 WebRTC；iPad 真机效果仍需线上验证。

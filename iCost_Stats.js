/**
 * iCost Pro - 3秒会话累计版
 * 核心逻辑：
 * 1. 自动检测“连续请求”：3秒内的请求会自动累加计数。
 * 2. 超过3秒没有新请求，自动重置为1，视为新的一批。
 * 3. 完美适配“批量上传”场景。
 */

// 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";
const storageKey_Session = "iCost_Session_Data";

// 辅助函数：判断平台
function getPlatform(url) {
    if (url.includes("deepseek")) return "DeepSeek";
    if (url.includes("volces")) return "火山引擎";
    if (url.includes("siliconflow")) return "硅基流动";
    if (url.includes("openrouter")) return "OpenRouter";
    if (url.includes("moonshot")) return "月之暗面";
    if (url.includes("google") || url.includes("googleapis")) return "Google Gemini";
    if (url.includes("openai")) return "OpenAI";
    if (url.includes("anthropic")) return "Claude";
    return "AI Service";
}

// 主逻辑
if (typeof $response === 'undefined') {
    // === Request 阶段 ===
    $persistentStore.write(Date.now().toString(), storageKey_Start);
    $done({});
} else {
    // === Response 阶段 ===
    let startTime = $persistentStore.read(storageKey_Start);
    
    if (startTime) {
        let now = Date.now();
        let durationMs = now - parseInt(startTime);
        
        // 1. 读取之前的会话数据
        let sessionData = { count: 0, input: 0, output: 0, lastTime: 0 };
        let sessionStr = $persistentStore.read(storageKey_Session);
        if (sessionStr) {
            try { sessionData = JSON.parse(sessionStr); } catch(e) {}
        }

        // 2. 判断是否属于“同一批次” 
        // 🔥 修改点：这里改成了 3000 (即 3秒) 🔥
        if (now - sessionData.lastTime > 3000) {
            // 如果距离上次请求超过 3秒，重置计数器
            sessionData = { count: 0, input: 0, output: 0, lastTime: 0 };
        }

        // 3. 解析本次 Token
        let body = $response.body;
        let currentPrompt = 0;
        let currentCompletion = 0;
        let modelName = "Unknown";
        
        try {
            if (body) {
                let obj = JSON.parse(body);
                modelName = obj.model || "Unknown";
                if (obj.usage) {
                    currentPrompt = obj.usage.prompt_tokens || 0;
                    currentCompletion = obj.usage.completion_tokens || 0;
                }
            }
        } catch (e) {}

        // 4. 累加数据
        sessionData.count += 1;
        sessionData.input += currentPrompt;
        sessionData.output += currentCompletion;
        sessionData.lastTime = now; // 更新最后活动时间

        // 5. 保存回存储
        $persistentStore.write(JSON.stringify(sessionData), storageKey_Session);

        // 6. 计算显示数据
        let platformName = getPlatform($request.url);
        let durationSec = (durationMs / 1000).toFixed(2);

        $notification.post(
            `${platformName} | ${modelName}`,
            `请求耗时: ${durationSec} s`,
            `本批次已处理: ${sessionData.count} 张/条\n⬆️In: ${sessionData.input}  ⬇️Out: ${sessionData.output}`
        );
        
        // 清理 Request 时间
        $persistentStore.write(null, storageKey_Start);
    }
    
    $done({});
}

/**
 * iCost Pro - 固定标题极简版
 * 核心功能：
 * 1. 标题固定显示为 "🤖 iCost AI 服务监控"
 * 2. 内容只显示：平台模型 + 耗时 + Token
 * 3. 逻辑纯净，无历史累计
 */

// 1. 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";

// 2. 固定标题 (这里就是你要修改的标题文字)
const NOTIFICATION_TITLE = "🤖 iCost AI 服务监控";

// 3. 辅助函数：判断平台
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

// 4. 主逻辑
if (typeof $response === 'undefined') {
    // === Request 阶段 ===
    $persistentStore.write(Date.now().toString(), storageKey_Start);
    $done({});
} else {
    // === Response 阶段 ===
    let startTime = $persistentStore.read(storageKey_Start);
    
    if (startTime) {
        let durationMs = Date.now() - parseInt(startTime);
        let durationSec = (durationMs / 1000).toFixed(2);
        
        let body = $response.body;
        try {
            if (body) {
                let obj = JSON.parse(body);
                
                // 只要是有效响应
                if (obj.model || obj.usage || obj.choices || obj.candidates) {
                    
                    let modelName = obj.model || "Unknown";
                    let platformName = getPlatform($request.url);
                    
                    // 提取 Token
                    let prompt = 0;
                    let completion = 0;
                    if (obj.usage) {
                        prompt = obj.usage.prompt_tokens || 0;
                        completion = obj.usage.completion_tokens || 0;
                    }
                    
                    // 组合显示内容
                    // 第一行参数：固定标题
                    // 第二行参数：副标题 (平台 | 模型)
                    // 第三行参数：正文 (耗时 + Token)
                    $notification.post(
                        NOTIFICATION_TITLE,
                        `${platformName} | ${modelName}`,
                        `请求耗时: ${durationSec} s\n⬆️In: ${prompt}  ⬇️Out: ${completion}`
                    );
                }
            }
        } catch (e) {
            // console.log("iCost Error");
        }
        
        $persistentStore.write(null, storageKey_Start);
    }
    
    $done({});
}

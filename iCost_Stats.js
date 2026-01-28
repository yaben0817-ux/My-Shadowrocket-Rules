/**
 * iCost Pro - 历史统计增强版 (精准计数修正版)
 * 功能：✅ 过滤无效请求  ✅ 仅统计成功生成的对话  ✅ 修正历史计数逻辑
 */

// 1. 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";
const storageKey_Stats = "iCost_History_Data";

// 2. 辅助函数：根据 URL 判断平台
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

// 3. 辅助函数：更新历史统计数据 (核心修改：增加有效性判断)
function updateHistoryStats(currentDurationMs) {
    let statsStr = $persistentStore.read(storageKey_Stats);
    let stats = { total_count: 0, total_time_ms: 0 };
    
    if (statsStr) {
        try {
            stats = JSON.parse(statsStr);
        } catch (e) {
            console.log("iCost Data Reset");
        }
    }

    // 只有在被显式调用时才累加
    stats.total_count += 1;
    stats.total_time_ms += currentDurationMs;

    $persistentStore.write(JSON.stringify(stats), storageKey_Stats);

    let avg_s = (stats.total_time_ms / stats.total_count / 1000).toFixed(2);
    return { count: stats.total_count, avg_s: avg_s };
}

// 4. 主逻辑
if (typeof $response === 'undefined') {
    // === Request 阶段 ===
    $persistentStore.write(Date.now().toString(), storageKey_Start);
    $done({});
} else {
    // === Response 阶段 ===
    let startTime = $persistentStore.read(storageKey_Start);
    
    // 只有当有开始时间时才处理，防止重复触发
    if (startTime) {
        let durationMs = Date.now() - parseInt(startTime);
        let durationSec = (durationMs / 1000).toFixed(2);
        
        // 解析 Body
        let body = $response.body;
        try {
            if (body) {
                let obj = JSON.parse(body);
                
                // 🔥 核心修正：只有当 usage 存在时，才进行计数和计算 🔥
                if (obj.usage) {
                    // 1. 此时才调用更新历史数据的函数
                    let history = updateHistoryStats(durationMs);
                    
                    // 2. 提取数据
                    let modelName = obj.model || "Unknown";
                    let platformName = getPlatform($request.url);
                    const prompt = obj.usage.prompt_tokens || 0;
                    const completion = obj.usage.completion_tokens || 0;
                    
                    // 3. 组合文案
                    let timeInfo = `请求耗时: ${durationSec} s`;
                    let historyInfo = `生成记录: ${history.count} 条, 平均: ${history.avg_s} s/条`;
                    let tokenStr = `⬆️In: ${prompt}  ⬇️Out: ${completion}`;
                    
                    // 4. 发送通知
                    $notification.post(
                        `${platformName} | ${modelName}`,
                        `${timeInfo}`,
                        `${historyInfo}\n${tokenStr}`
                    );
                } else {
                    console.log("iCost: 本次响应无 Token 信息，不计入历史统计。");
                }
            }
        } catch (e) {
            console.log("iCost Error: " + e);
        }
        
        // 无论成功失败，都清理开始时间，防止下一次误判
        $persistentStore.write(null, storageKey_Start);
    }
    
    $done({});
}

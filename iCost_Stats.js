/**
 * iCost Pro - 历史统计增强版
 * 功能：✅ 历史记录计数  ✅ 历史平均耗时(s)  ✅ Token统计  ✅ ms转s显示
 */

// 1. 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";  // 记录本次请求开始时间
const storageKey_Stats = "iCost_History_Data";     // 记录历史统计数据

// 2. 辅助函数：根据 URL 判断平台名称
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

// 3. 辅助函数：更新历史统计数据
function updateHistoryStats(currentDurationMs) {
    let statsStr = $persistentStore.read(storageKey_Stats);
    let stats = { total_count: 0, total_time_ms: 0 };
    
    // 读取旧数据
    if (statsStr) {
        try {
            stats = JSON.parse(statsStr);
        } catch (e) {
            console.log("iCost Stats Reset: Data corrupted");
        }
    }

    // 累加本次数据
    stats.total_count += 1;
    stats.total_time_ms += currentDurationMs;

    // 保存回存储
    $persistentStore.write(JSON.stringify(stats), storageKey_Stats);

    // 计算平均值 (转换为秒，保留2位小数)
    let avg_s = (stats.total_time_ms / stats.total_count / 1000).toFixed(2);
    
    return {
        count: stats.total_count,
        avg_s: avg_s
    };
}

// 4. 主逻辑
if (typeof $response === 'undefined') {
    // === 请求阶段：记录开始时间 ===
    $persistentStore.write(Date.now().toString(), storageKey_Start);
    $done({});
} else {
    // === 响应阶段：处理数据 ===
    let startTime = $persistentStore.read(storageKey_Start);
    
    // 初始化显示文本
    let timeInfo = "计算中...";
    
    if (startTime) {
        // A. 计算时间
        let endTime = Date.now();
        let durationMs = endTime - parseInt(startTime); // 毫秒
        let durationSec = (durationMs / 1000).toFixed(2); // 秒

        // B. 更新历史统计
        let history = updateHistoryStats(durationMs);
        
        // C. 格式化第一行显示
        timeInfo = `请求耗时: ${durationSec} s`;
        
        // D. 准备历史记录文本
        let historyInfo = `生成记录: ${history.count} 条, 平均: ${history.avg_s} s/条`;

        // E. 解析 Token
        let body = $response.body;
        try {
            if (body) {
                let obj = JSON.parse(body);
                let modelName = obj.model || "Unknown";
                let platformName = getPlatform($request.url);
                
                if (obj.usage) {
                    const prompt = obj.usage.prompt_tokens || 0;
                    const completion = obj.usage.completion_tokens || 0;
                    
                    // F. 组合 Token 信息
                    let tokenStr = `⬆️In: ${prompt}  ⬇️Out: ${completion}`;
                    
                    // G. 发送最终通知
                    $notification.post(
                        `${platformName} | ${modelName}`,
                        `${timeInfo}`,
                        `${historyInfo}\n${tokenStr}`
                    );
                }
            }
        } catch (e) {
            console.log("iCost Error: " + e);
        }
        
        // 清理本次计时
        $persistentStore.write(null, storageKey_Start);
    }
    
    $done({});
}

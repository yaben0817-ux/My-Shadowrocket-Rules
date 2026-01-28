/**
 * iCost Pro - 最终修正版
 * 修复问题：流式传输(Stream)下计数丢失的问题
 * 逻辑对齐：与原作者逻辑一致，只要是有效响应即计数
 */

// 1. 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";
const storageKey_Stats = "iCost_History_Stats_v2"; // 升级 Key 版本，避免旧数据干扰

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

// 3. 辅助函数：更新历史统计
function updateHistoryStats(currentDurationMs) {
    let statsStr = $persistentStore.read(storageKey_Stats);
    let stats = { total_count: 0, total_time_ms: 0 };
    
    if (statsStr) {
        try {
            stats = JSON.parse(statsStr);
        } catch (e) {
            console.log("iCost: History Data Reset");
        }
    }

    // 累加数据
    stats.total_count += 1;
    stats.total_time_ms += currentDurationMs;

    // 保存
    $persistentStore.write(JSON.stringify(stats), storageKey_Stats);

    // 计算平均值
    let avg_s = (stats.total_time_ms / stats.total_count / 1000).toFixed(2);
    return { count: stats.total_count, avg_s: avg_s };
}

// 4. 主逻辑
if (typeof $response === 'undefined') {
    // === Request 阶段：只负责记录开始时间 ===
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
                
                // 🔥 核心修正 🔥
                // 只要包含 'model' (模型名) 或 'choices' (回复内容) 或 'usage'，都视为有效对话
                // 这样即使 Stream 模式没返回 Token，也能准确记录耗时和条数
                if (obj.model || obj.choices || obj.usage) {
                    
                    // 1. 立即更新历史统计 (确保计数准确)
                    let history = updateHistoryStats(durationMs);
                    
                    // 2. 尝试提取 Token (如果没有则显示 0)
                    let prompt = 0;
                    let completion = 0;
                    if (obj.usage) {
                        prompt = obj.usage.prompt_tokens || 0;
                        completion = obj.usage.completion_tokens || 0;
                    }

                    // 3. 提取基础信息
                    let modelName = obj.model || "Unknown Model";
                    let platformName = getPlatform($request.url);
                    
                    // 4. 组装通知
                    // 格式：DeepSeek | r1
                    //      请求耗时: 1.5s
                    //      生成记录: 5 条, 平均: 1.2s/条 
                    //      ⬆️In: 50  ⬇️Out: 100
                    let tokenStr = `⬆️In: ${prompt}  ⬇️Out: ${completion}`;
                    // 如果没有 Token，加个提示
                    if (prompt === 0 && completion === 0) {
                        tokenStr += " (Stream模式无Token)";
                    }

                    $notification.post(
                        `${platformName} | ${modelName}`,
                        `请求耗时: ${durationSec} s`,
                        `生成记录: ${history.count} 条, 平均: ${history.avg_s} s/条\n${tokenStr}`
                    );
                }
            }
        } catch (e) {
            console.log("iCost Error: " + e);
        }
        
        // 清理时间，防止重复
        $persistentStore.write(null, storageKey_Start);
    }
    
    $done({});
}

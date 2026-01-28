/**
 * iCost Pro - 智能记账识别版 (最终版)
 * 功能清单：
 * 1. ✅ 智能识别批量单据数量 (1张图算1条, 5张图算5条)
 * 2. ✅ 精准统计 Token (In/Out)
 * 3. ✅ 计算单张单据的平均处理耗时
 */

// 1. 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";

// 2. 辅助函数：判断平台
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

// 3. 核心算法：智能计算业务条数
function calculateItemCount(obj) {
    try {
        // 尝试获取回复内容
        let content = "";
        if (obj.choices && obj.choices.length > 0) {
            content = obj.choices[0].message.content || "";
        } else if (obj.candidates && obj.candidates.length > 0) {
            content = obj.candidates[0].content.parts[0].text || ""; // 兼容 Gemini
        } else if (obj.output) {
             content = obj.output; // 兼容部分国产模型
        }

        if (!content) return 1; 

        // 清洗 Markdown 标记
        let cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();

        // 尝试解析 JSON 数组长度
        if (cleanJson.startsWith("[") || cleanJson.startsWith("{")) {
            let parsed = JSON.parse(cleanJson);
            if (Array.isArray(parsed)) return parsed.length; // 直接返回数组长度
            if (parsed.items && Array.isArray(parsed.items)) return parsed.items.length;
            if (parsed.data && Array.isArray(parsed.data)) return parsed.data.length;
        }
    } catch (e) {
        // 解析失败按 1 条算
    }
    return 1; 
}

// 4. 主逻辑
if (typeof $response === 'undefined') {
    //Request
    $persistentStore.write(Date.now().toString(), storageKey_Start);
    $done({});
} else {
    //Response
    let startTime = $persistentStore.read(storageKey_Start);
    
    if (startTime) {
        let durationMs = Date.now() - parseInt(startTime);
        let durationSec = (durationMs / 1000).toFixed(2);
        
        let body = $response.body;
        try {
            if (body) {
                let obj = JSON.parse(body);
                
                // 只要是有效响应
                if (obj.choices || obj.candidates || obj.output || obj.usage) {
                    
                    let modelName = obj.model || "Unknown";
                    let platformName = getPlatform($request.url);
                    
                    // A. 智能计算条数
                    let recordCount = calculateItemCount(obj);
                    
                    // B. 提取 Token (这里就是你要的功能)
                    let prompt = 0;
                    let completion = 0;
                    if (obj.usage) {
                        prompt = obj.usage.prompt_tokens || 0;
                        completion = obj.usage.completion_tokens || 0;
                    }

                    // C. 计算平均耗时
                    let avgTimePerItem = (durationMs / recordCount).toFixed(0);

                    // D. 发送通知
                    // 格式：
                    // 请求耗时: 2.50 s
                    // 识别单据: 5 张, 平均: 500 ms/张
                    // ⬆️In: 1500  ⬇️Out: 3000
                    
                    let tokenStr = `⬆️In: ${prompt}  ⬇️Out: ${completion}`;
                    if (prompt === 0 && completion === 0) tokenStr += " (无Token数据)";

                    $notification.post(
                        `${platformName} | ${modelName}`,
                        `请求耗时: ${durationSec} s`,
                        `识别单据: ${recordCount} 张, 平均: ${avgTimePerItem} ms/张\n${tokenStr}`
                    );
                }
            }
        } catch (e) {
            console.log("iCost Error: " + e);
        }
        
        $persistentStore.write(null, storageKey_Start);
    }
    
    $done({});
}

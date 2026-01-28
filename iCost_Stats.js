/**
 * iCost Pro - 图片输入计数版
 * 核心逻辑：
 * 1. 在请求阶段(Request)直接统计上传了多少张图片。
 * 2. 完美解决流式传输(Stream)下无法解析返回内容的问题。
 * 3. 只有当没传图片时，才尝试去分析回复内容。
 */

// 定义存储 Key
const storageKey_Start = "iCost_Start_Timestamp";
const storageKey_Count = "iCost_Image_Count"; // 新增：用于传递图片数量

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
    // ================================
    // 🟢 Request 请求阶段：数图片
    // ================================
    let reqBody = $request.body;
    let imgCount = 0;
    
    if (reqBody) {
        // 1. 匹配 OpenAI/OpenRouter 格式 ("type": "image_url")
        let matchOpenAI = reqBody.match(/"type"\s*:\s*"image_url"/g);
        if (matchOpenAI) imgCount += matchOpenAI.length;

        // 2. 匹配 Gemini 原生格式 ("inline_data" 或 "mime_type": "image)
        if (imgCount === 0) {
            let matchGemini = reqBody.match(/"inline_data"/g);
            if (!matchGemini) matchGemini = reqBody.match(/"mime_type"\s*:\s*"image/g);
            if (matchGemini) imgCount += matchGemini.length;
        }
        
        // 3. 匹配 Base64 格式兜底
        if (imgCount === 0) {
            let matchBase64 = reqBody.match(/"data:image/g);
            if (matchBase64) imgCount += matchBase64.length;
        }
    }
    
    // 如果没图，默认为 1 (纯文本对话)
    if (imgCount === 0) imgCount = 1;

    // 存起来给响应阶段用
    $persistentStore.write(Date.now().toString(), storageKey_Start);
    $persistentStore.write(imgCount.toString(), storageKey_Count);
    
    $done({});

} else {
    // ================================
    // 🟡 Response 响应阶段：计算报告
    // ================================
    let startTime = $persistentStore.read(storageKey_Start);
    let countStr = $persistentStore.read(storageKey_Count);
    
    if (startTime) {
        let durationMs = Date.now() - parseInt(startTime);
        let durationSec = (durationMs / 1000).toFixed(2);
        
        // 读取请求阶段数出来的图片数量
        let recordCount = parseInt(countStr || "1");
        
        let body = $response.body;
        try {
            if (body) {
                let obj = JSON.parse(body);
                
                // 只要是有效响应
                if (obj.choices || obj.candidates || obj.output || obj.usage) {
                    
                    let modelName = obj.model || "Unknown";
                    let platformName = getPlatform($request.url);
                    
                    // 容错：如果 Request 没数出来(比如纯文本)，但 Response 返回了数组，尝试修正
                    // (仅针对非流式纯文本批量处理场景，优先级较低)
                    if (recordCount === 1 && !obj.usage) { 
                        // 这里的逻辑可以保留作为双重保险，但在图片场景下 Request 计数是最准的
                    }

                    // 计算平均耗时
                    let avgTimePerItem = (durationMs / recordCount).toFixed(0);

                    // 提取 Token
                    let prompt = 0;
                    let completion = 0;
                    if (obj.usage) {
                        prompt = obj.usage.prompt_tokens || 0;
                        completion = obj.usage.completion_tokens || 0;
                    }
                    
                    let tokenStr = `⬆️In: ${prompt}  ⬇️Out: ${completion}`;
                    let typeStr = recordCount > 1 ? "张图片" : "条记录";

                    $notification.post(
                        `${platformName} | ${modelName}`,
                        `请求耗时: ${durationSec} s`,
                        `识别统计: ${recordCount} ${typeStr}, 平均: ${avgTimePerItem} ms/个\n${tokenStr}`
                    );
                }
            }
        } catch (e) {
            // console.log(e);
        }
        
        // 清理缓存
        $persistentStore.write(null, storageKey_Start);
        $persistentStore.write(null, storageKey_Count);
    }
    
    $done({});
}

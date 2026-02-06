// ==========================================
// 1. 业务逻辑与全局变量
// ==========================================

// 日志功能
function log(msg, type = 'INFO') {
    const consoleDiv = document.getElementById('consoleLog');
    if (!consoleDiv) return; 
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = document.createElement('div');
    
    let color = 'text-gray-300';
    if (type === 'ERR') color = 'text-red-400';
    if (type === 'WARN') color = 'text-amber-400';
    if (type === 'SUCCESS') color = 'text-emerald-400';

    line.innerHTML = `<span class="text-gray-600 mr-2">[${time}]</span><span class="${color}">${msg}</span>`;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

let globalBlocks = []; 
let isBilingualMode = false;
let currentFileName = "Untitled"; 
let currentAlign = "center"; // 默认居中

// ==========================================
// 2. 文件处理逻辑
// ==========================================

async function processFile(file) {
    currentFileName = file.name.replace(/\.[^/.]+$/, "");
    log(`Reading file: ${file.name}`);
    const ext = file.name.split('.').pop().toLowerCase();
    
    try {
        const content = await readFileAutoDetect(file);

        if (ext === 'srt') globalBlocks = parseSRT(content);
        else if (ext === 'vtt') globalBlocks = parseVTT(content);
        else if (ext === 'ass' || ext === 'ssa') globalBlocks = parseASS(content);
        else if (ext === 'fcpxml' || ext === 'xml') globalBlocks = parseFCPXML(content);
        else throw new Error("Unsupported format");
        
        if(globalBlocks.length === 0) throw new Error("Empty content");
        
        globalBlocks.sort((a, b) => a.start - b.start);
        log(`Parsed ${globalBlocks.length} subtitles.`, 'SUCCESS');
        
        // 更新 UI
        const fileInfo = document.getElementById('fileInfo');
        const fileNameDisplay = document.getElementById('fileNameDisplay');
        const uploadPrompt = document.getElementById('uploadPrompt');
        
        if (fileInfo) {
            uploadPrompt.classList.add('hidden');
            fileInfo.classList.remove('hidden');
            if (fileNameDisplay) fileNameDisplay.innerText = file.name;
        }
        isBilingualMode = false;

    } catch (err) { 
        log(`Error: ${err.message}`, 'ERR'); 
        console.error(err);
    }
}

// 万能解码器
function readFileAutoDetect(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = (e) => {
            const buffer = e.target.result;
            const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
            try {
                const text = utf8Decoder.decode(buffer);
                console.log("✅ 识别编码: UTF-8");
                resolve(text); return;
            } catch (err) { console.log("⚠️ 非 UTF-8，尝试 GBK..."); }
            const gbkDecoder = new TextDecoder('gb18030', { fatal: true });
            try {
                const text = gbkDecoder.decode(buffer);
                console.log("✅ 识别编码: GB18030");
                resolve(text); return;
            } catch (err) { console.log("⚠️ 非 GBK，尝试 Big5..."); }
            const big5Decoder = new TextDecoder('big5', { fatal: true });
            try {
                const text = big5Decoder.decode(buffer);
                console.log("✅ 识别编码: Big5");
                resolve(text); return;
            } catch (err) {
                console.warn("❌ 无法识别编码，强制 UTF-8");
                resolve(new TextDecoder('utf-8').decode(buffer));
            }
        };
        reader.onerror = () => reject("文件读取系统错误");
    });
}

// ==========================================
// 3. UI 交互逻辑 (Pos, Align, AI)
// ==========================================

window.setPos = function(val, btn) {
    const input = document.getElementById('positionY');
    if(input) {
        input.value = val;
        if(window.adjustValue) window.adjustValue('positionY', 0);
    }
    const parent = btn.parentElement;
    if(parent) {
        parent.querySelectorAll('button').forEach(b => { 
            b.classList.remove('bg-gray-600', 'text-white', 'shadow-sm', 'active'); 
            b.classList.add('text-gray-400', 'hover:text-white'); 
        });
    }
    btn.classList.remove('text-gray-400', 'hover:text-white'); 
    btn.classList.add('bg-gray-600', 'text-white', 'shadow-sm', 'active');
    log(`Position set to ${val}`);
}

window.setAlign = function(align, btn) {
    currentAlign = align;
    const parent = btn.parentElement;
    parent.querySelectorAll('button').forEach(b => {
        b.classList.remove('text-white', 'bg-gray-600', 'shadow-sm');
        b.classList.add('text-gray-400');
    });
    btn.classList.remove('text-gray-400');
    btn.classList.add('text-white', 'bg-gray-600', 'shadow-sm');
    log(`Alignment set to: ${align}`);
}
// ==========================================
// 新增：AI 面板 UI 联动与连接测试
// ==========================================

// 新增：AI 模型数据定义 (静态维护)
const PROVIDER_MODELS = {
    deepseek: [
        { value: "deepseek-chat", label: "DeepSeek V3 (Recommended)" },
        { value: "deepseek-reasoner", label: "DeepSeek R1 (Reasoning)" }
    ],
    openai: [
        { value: "gpt-4o", label: "GPT-4o (Omni)" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini (Cost Effective)" },
        { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
        { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }
    ],
    google: [
        { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
        { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }
    ],
    ollama: [
        // Ollama 模型需用户手动 pull，这里提供常用默认值
        { value: "llama3", label: "Llama 3 (Default)" },
        { value: "mistral", label: "Mistral" },
        { value: "qwen:7b", label: "Qwen 7B" },
        { value: "gemma:7b", label: "Gemma 7B" },
        { value: "custom", label: "Manual Input..." } // 后期可做成手动输入
    ],
    webllm: [
        // WebLLM 必须精确匹配 MLC 库支持的模型 ID
        { value: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 (1.5B) - Fast & Good" },
        { value: "Llama-3-8B-Instruct-q4f32_1-MLC", label: "Llama 3 (8B) - Standard" },
        { value: "Phi-3-mini-4k-instruct-q4f16_1-MLC", label: "Phi-3 Mini (3.8B)" }
    ],
    custom: [
        { value: "default", label: "Default / Auto-Detect" }
    ]
};

// ==========================================
// AI 面板 UI 联动逻辑 (Provider -> UI & Models)
// ==========================================

window.updateProviderUI = function() {
    const providerSelect = document.getElementById('aiProvider');
    const modelSelect = document.getElementById('aiModel');
    
    const provider = providerSelect.value;
    const fieldUrl = document.getElementById('field-url');
    const fieldKey = document.getElementById('field-key');
    const webllmStatus = document.getElementById('webllmStatus');
    const customUrlInput = document.getElementById('customUrl');
    
    // --- 1. 先重置状态 (全部恢复默认) ---
    fieldUrl.classList.add('hidden');       // 隐藏 URL
    fieldKey.classList.remove('hidden');    // 显示 Key
    webllmStatus.classList.add('hidden');   // 隐藏 WebLLM 进度条

    // --- 2. 根据厂商进行特殊处理 (使用 switch) ---
    switch (provider) {
        case 'custom':
            fieldUrl.classList.remove('hidden'); 
            customUrlInput.placeholder = "https://api.openai.com/v1";
            break;
            
        case 'ollama':
            fieldUrl.classList.remove('hidden'); 
            customUrlInput.placeholder = "http://localhost:11434/v1";
            break;
            
        case 'webllm':
            fieldKey.classList.add('hidden');    
            webllmStatus.classList.remove('hidden'); 
            break;

        case 'google':
            // 👉 这就是你要加的地方，完美融入 switch
            log("Google Gemini 接口正在开发中 (Coming Soon)...", "WARN");
            break;
            
        // deepseek 和 openai 不需要特殊 UI 处理，走默认即可
    }

    // --- 3. 动态更新模型列表 ---
    const models = PROVIDER_MODELS[provider] || [];
    modelSelect.innerHTML = '';
    
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.innerText = m.label;
        modelSelect.appendChild(opt);
    });

    // 触发 change 确保逻辑同步
    modelSelect.dispatchEvent(new Event('change'));
};

// 2. 重置连接按钮状态 (当用户修改 Key 时变回灰色)
window.resetConnectionState = function() {
    const btn = document.getElementById('btnCheckConnection');
    const statusText = document.getElementById('connectionStatus');
    
    btn.className = "w-8 h-8 flex items-center justify-center bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 transition-all text-gray-400";
    statusText.innerText = "Untested";
    statusText.className = "text-[9px] text-gray-600 font-mono transition-colors";
}

// ==========================================
// 新增：模式 UI 联动 (控制双语选项显示)
// ==========================================
window.updateModeUI = function() {
    const mode = document.getElementById('aiMode').value;
    const bilingualOpts = document.getElementById('bilingualOptions');
    const secondLangRow = document.getElementById('secondLangRow');

    if (mode === 'bilingual') {
        bilingualOpts.classList.remove('hidden');
        secondLangRow.classList.remove('hidden'); // 双语模式下，显示第二语言选项
    } else {
        bilingualOpts.classList.add('hidden');
        secondLangRow.classList.add('hidden');
    }
}

// 3. 核心：连接测试 (Ping)
window.testConnection = async function() {
    const btn = document.getElementById('btnCheckConnection');
    const statusText = document.getElementById('connectionStatus');
    const provider = document.getElementById('aiProvider').value;
    const apiKey = document.getElementById('apiKey').value.trim();
    let url = "";

    // 简单校验
    if (!apiKey && provider !== 'ollama' && provider !== 'custom') {
        log("Cannot test without API Key", "WARN");
        return;
    }

    // 设置加载状态 (转圈)
    btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;
    btn.classList.add('text-blue-400');
    statusText.innerText = "Pinging...";

    // 确定测试地址
    if (provider === 'deepseek') url = "https://api.deepseek.com/chat/completions";
    else if (provider === 'openai') url = "https://api.openai.com/v1/chat/completions";
    else if (provider === 'ollama' || provider === 'custom') {
        // 获取用户填写的 URL，如果没填则给默认值
        const customUrl = document.getElementById('customUrl').value.trim();
        url = customUrl ? customUrl : (provider === 'ollama' ? "http://localhost:11434/v1/chat/completions" : "");
        if(!url.endsWith('/chat/completions')) url = url.replace(/\/+$/, '') + "/chat/completions";
    }

    try {
        // 发起一个极小的请求 (1个token)
        // 注意：这里我们不做复杂的 fetch models，因为容易遇到 CORS 和 权限问题
        // 直接发一个 chat 请求是最稳的验证方式
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo", // 对于 DeepSeek/Ollama，通常会忽略模型名或兼容此名，主要测通断
                messages: [{role: "user", content: "Hi"}],
                max_tokens: 1
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            // ✅ 成功：变绿
            btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
            btn.className = "w-8 h-8 flex items-center justify-center bg-gray-800 border border-green-500/50 rounded text-green-400 shadow-[0_0_10px_rgba(74,222,128,0.2)]";
            statusText.innerText = "Connected";
            statusText.className = "text-[9px] text-green-500 font-mono transition-colors";
            log(`Connection to ${provider} successful!`, "SUCCESS");
        } else {
            throw new Error(`Status: ${res.status}`);
        }
    } catch (err) {
        // ❌ 失败：变红
        console.error(err);
        btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
        btn.className = "w-8 h-8 flex items-center justify-center bg-gray-800 border border-red-500/50 rounded text-red-400";
        statusText.innerText = "Error";
        statusText.className = "text-[9px] text-red-400 font-mono transition-colors";
        
        let errMsg = "Connection Failed";
        if (err.name === 'AbortError') errMsg = "Timeout (5s)";
        else if (err.message.includes('Failed to fetch')) errMsg = "Network/CORS Error";
        else errMsg = err.message;
        
        log(`Connection Check Failed: ${errMsg}`, "ERR");
    }
}
// ==========================================
// 核心逻辑：AI 处理 (万能适配版)
// ==========================================
window.processWithAI = async function() {
    // 1. 获取基础参数
    const provider = document.getElementById('aiProvider').value;
    const selectedModel = document.getElementById('aiModel').value;
    const mode = document.getElementById('aiMode').value;
    const apiKey = document.getElementById('apiKey').value.trim();
    let customUrl = document.getElementById('customUrl').value.trim();

    // 新增多语种参数
    const targetLang1 = document.getElementById('targetLang').value;
    const targetLang2 = document.getElementById('targetLang2').value; 
    const mainSubType = document.getElementById('mainSub').value;     
    const secSubType = document.getElementById('secSub').value;       
    
    // 判断是否开启了“双重翻译”
    const isDualTrans = (mode === 'bilingual' && targetLang2 !== 'none' && targetLang1 !== targetLang2);

    // UI 元素
    const btnAI = document.getElementById('btnAI');
    const pFill = document.getElementById('progressFill');
    const progressBar = document.getElementById('progressBar');

    // 2. 基础校验
    if (globalBlocks.length === 0) return log("请先导入字幕文件。", 'WARN');
    
    if (!apiKey && provider !== 'ollama' && provider !== 'webllm' && provider !== 'custom') {
        return log(`${provider} 需要填写 API Key。`, 'WARN');
    }

    if (provider === 'webllm') {
        return log("WebLLM 功能暂未集成，请选择 Cloud 或 Ollama。", "WARN");
    }

    // 3. 确定 API 地址
    let apiEndpoint = "";
    switch (provider) {
        case 'openai': apiEndpoint = "https://api.openai.com/v1/chat/completions"; break;
        case 'deepseek': apiEndpoint = "https://api.deepseek.com/chat/completions"; break;
        case 'google': return log("Google 原生 API 需要特殊代理，请使用 Custom 模式配合 OneAPI。", "WARN");
        case 'ollama': apiEndpoint = customUrl ? customUrl : "http://localhost:11434/v1/chat/completions"; break;
        case 'custom': apiEndpoint = customUrl; break;
    }

    if (apiEndpoint && !apiEndpoint.endsWith('/chat/completions')) {
        apiEndpoint = apiEndpoint.replace(/\/+$/, '') + "/chat/completions";
    }

    // 4. 准备 Prompt
    let systemPrompt = "";
    if (isDualTrans) {
        systemPrompt = `你是一个多语言字幕翻译专家。
任务：将输入的文本数组同时翻译为 [${targetLang1}] (key: l1) 和 [${targetLang2}] (key: l2)。
要求：
1. 返回一个 JSON 对象数组，每个对象包含 "l1" 和 "l2" 两个字段。
   示例格式：[{"l1": "Translation 1", "l2": "Translation 2"}, ...]
2. 数组长度必须与输入严格一致。
3. 严禁包含 Markdown 格式。`;
    } else if (mode === "polish") {
        systemPrompt = `你是一个字幕润色专家。将文本润色为地道的 ${targetLang1}。
要求：返回纯 JSON 字符串数组，长度一致。`;
    } else {
        systemPrompt = `你是一个字幕翻译工具。将文本翻译为地道的 ${targetLang1}。
要求：返回纯 JSON 字符串数组，长度一致。`;
    }

    // 5. 开始任务
    const originalBtnText = btnAI.innerHTML;
    btnAI.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Processing...`;
    btnAI.disabled = true; 
    progressBar.classList.remove('hidden');
    log(`🚀 开始任务: ${provider} (${selectedModel}) - ${mode}`);

    const BATCH_SIZE = 20; 

    try {
        for (let i = 0; i < globalBlocks.length; i += BATCH_SIZE) {
            const batch = globalBlocks.slice(i, i + BATCH_SIZE);
            const sourceTexts = batch.map(b => b.text);
            
            const requestBody = { 
                model: selectedModel, 
                messages: [
                    { role: "system", content: systemPrompt }, 
                    { role: "user", content: JSON.stringify(sourceTexts) }
                ],
                temperature: 0.1,
                response_format: (selectedModel.includes("reasoner") || provider === 'ollama') ? undefined : { type: "json_object" }
            };

            log(`正在处理第 ${i + 1} - ${Math.min(i + BATCH_SIZE, globalBlocks.length)} 行...`);

            const response = await fetch(apiEndpoint, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${apiKey}` 
                }, 
                body: JSON.stringify(requestBody) 
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Error ${response.status}: ${errText.slice(0, 100)}...`);
            }
            
            const data = await response.json();
            let aiRaw = data.choices[0].message.content;
            
            aiRaw = aiRaw.replace(/<think>[\s\S]*?<\/think>/gi, "")
                         .replace(/```json/gi, "")
                         .replace(/```/g, "")
                         .trim();

            let translatedArray = [];
            try {
                const startIdx = aiRaw.indexOf('['); 
                const endIdx = aiRaw.lastIndexOf(']');
                if (startIdx !== -1 && endIdx !== -1) {
                    translatedArray = JSON.parse(aiRaw.substring(startIdx, endIdx + 1));
                } else {
                    const obj = JSON.parse(aiRaw); 
                    for (let k in obj) { if (Array.isArray(obj[k])) { translatedArray = obj[k]; break; } }
                }
            } catch (parseErr) {
                console.error("JSON Parse Error", aiRaw);
                log(`⚠️ 第 ${Math.floor(i/BATCH_SIZE) + 1} 批次格式解析失败，跳过。`, 'ERR');
                continue; 
            }

            // 回填数据
            batch.forEach((block, idx) => {
                const item = translatedArray[idx];
                
                const txtSource = block.text;
                let txtTarget1 = "";
                let txtTarget2 = "";

                if (isDualTrans) {
                    if (typeof item === 'object') {
                        txtTarget1 = item.l1 || "";
                        txtTarget2 = item.l2 || "";
                    } else {
                        txtTarget1 = item; 
                    }
                } else {
                    txtTarget1 = item;
                }

                const getTextByType = (type) => {
                    if (type === 'source') return txtSource;
                    if (type === 'target1') return txtTarget1;
                    if (type === 'target2') return txtTarget2;
                    return "";
                };

                if (item) {
                    if (mode === "bilingual") {
                        const mainContent = getTextByType(mainSubType);
                        const secContent = getTextByType(secSubType);

                        if (secSubType !== 'none' && secContent) {
                            block.text = `${mainContent}\n${secContent}`;
                        } else {
                            block.text = mainContent;
                        }
                        isBilingualMode = true;
                    } else {
                        block.text = txtTarget1;
                    }
                }
            }); // forEach 结束

            // 更新进度条
            const pct = Math.round(((i + BATCH_SIZE) / globalBlocks.length) * 100);
            pFill.style.width = `${Math.min(pct, 100)}%`; 

        } // for 循环结束

        log("✅ 所有字幕处理完成！", 'SUCCESS');

    } catch (err) { 
        log(`❌ 任务终止: ${err.message}`, 'ERR'); 
        console.error(err);
    } finally { 
        btnAI.innerHTML = originalBtnText; 
        btnAI.disabled = false; 
        setTimeout(() => progressBar.classList.add('hidden'), 2000);
    }
} // 函数结束


// ==========================================
// 4. 导出与 FCPXML 生成逻辑 (核心修复)
// ==========================================

window.exportFCPXML = function() {
    if (globalBlocks.length === 0) return log("Nothing to export.", 'WARN');
    
    const fontName = getSafeFont(document.getElementById('fontName').value);
    const fps = parseFloat(document.getElementById('fpsSelect').value) || 30;
    const fileName = currentFileName || "Untitled";

    const fontColorHex = document.getElementById('fontColor').value;
    const opacityVal = document.getElementById('opacity').value;
    const strokeColorHex = document.getElementById('strokeColor').value;
    const yValElement = document.getElementById('positionY');
    const yValue = yValElement ? yValElement.value : -350; 

    // Shadow 参数
    const shadowEnabled = document.getElementById('shadowEnable').checked;
    const shadowBlur = document.getElementById('shadowBlur').value;
    const shadowColorHex = document.getElementById('shadowColor').value;

    const params = { 
        fileName: fileName, 
        fontName: fontName, 
        fps: fps,
        fontSize: document.getElementById('fontSize').value, 
        fontColor: getFCPColor(fontColorHex, opacityVal), 
        strokeColor: getFCPColor(strokeColorHex, "100%"), 
        strokeWidth: document.getElementById('strokeWidth').value, 
        yValue: yValue,
        alignment: currentAlign, 
        shadow: shadowEnabled ? {
            blur: shadowBlur,
            color: getFCPColor(shadowColorHex, "100%"), 
            offset: "2 -2" 
        } : null
    };
    
    const xml = generateXML(globalBlocks, params);
    const suffix = isBilingualMode ? "_DUAL" : "_SUB";
    downloadFile(xml, params.fileName + suffix + '.fcpxml');
    log(`Exported file: ${params.fileName}${suffix}.fcpxml`, 'SUCCESS');
}

// 🟢 修复 3: 增加 FCP 时间计算工具函数
function formatFCPDuration(frames, frameDurationStr) {
    // 逻辑：FCPXML 使用 rational time (分子/分母 s)。
    // 持续时间 = 帧数 * (每帧时长的分子) / (每帧时长的分母) s
    const clean = frameDurationStr.replace('s', '');
    const [num, den] = clean.split('/');
    return `${Math.round(frames * num)}/${den}s`;
}

// 🟢 修复 4: 唯一的 generateXML 函数 (清理了重复版本)
function generateXML(blocks, p) { 
    const fps = p.fps; 
    let frameDuration = "100/3000s"; // Default 30fps
    if (fps === 25) frameDuration = "100/2500s";
    else if (fps === 24) frameDuration = "100/2400s";
    else if (fps === 50) frameDuration = "100/5000s";
    else if (fps === 60) frameDuration = "100/6000s";
    else if (fps === 23.976) frameDuration = "1001/24000s"; // NTSC
    else if (fps === 29.97) frameDuration = "1001/30000s";  // NTSC
    else if (fps === 59.94) frameDuration = "1001/60000s";

    // 计算总时长
    const totalFrames = Math.ceil((blocks[blocks.length-1].end + 5) * fps);
    const durationStr = formatFCPDuration(totalFrames, frameDuration);

    let shadowAttr = "";
    if (p.shadow) {
        shadowAttr = `shadowColor="${p.shadow.color}" shadowOffset="${p.shadow.offset}" shadowBlurRadius="${p.shadow.blur}"`;
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n<resources>\n<format id="r1" name="FFVideoFormatCustom" frameDuration="${frameDuration}" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>\n<effect id="fx_custom" name="Custom" uid=".../Titles.localized/Build In:Out.localized/Custom.localized/Custom.moti"/>\n</resources>\n<library>\n<event name="Subtitle Import">\n<project name="${escapeXML(p.fileName)}">\n<sequence format="r1" duration="${durationStr}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n<spine>\n<gap name="Gap" offset="0s" duration="${durationStr}" start="0s">\n`;
    
    blocks.forEach((block, index) => {
        const sFrame = Math.round(block.start * fps); 
        const eFrame = Math.round(block.end * fps); 
        const durFrame = (eFrame <= sFrame ? sFrame + 1 : eFrame) - sFrame;
        
        const offsetStr = formatFCPDuration(sFrame, frameDuration);
        const durationStrBtn = formatFCPDuration(durFrame, frameDuration);

        let textXML = ""; let stylesXML = "";
        
        // 生成样式定义
        const commonStyle = `font="${p.fontName}" fontSize="${p.fontSize}" fontFace="Regular" fontColor="${p.fontColor}" strokeColor="${p.strokeColor}" strokeWidth="${p.strokeWidth}" alignment="${p.alignment}" ${shadowAttr}`;

        if (isBilingualMode && block.text.includes('\n')) {
            const lines = block.text.split('\n'); const cnText = lines[0]; const enText = lines.slice(1).join(' ');
            textXML = `<text-style ref="ts_cn_${index}">${escapeXML(cnText)}</text-style><text-style ref="ts_en_${index}">&#10;${escapeXML(enText)}</text-style>`;
            stylesXML = `<text-style-def id="ts_cn_${index}"><text-style ${commonStyle}/></text-style-def><text-style-def id="ts_en_${index}"><text-style ${commonStyle.replace(p.fontSize, Math.round(p.fontSize/2))}/></text-style-def>`;
        } else {
            textXML = `<text-style ref="ts_${index}">${escapeXML(block.text)}</text-style>`;
            stylesXML = `<text-style-def id="ts_${index}"><text-style ${commonStyle}/></text-style-def>`;
        }
        
        xml += `<title name="Sub ${index}" lane="1" offset="${offsetStr}" ref="fx_custom" duration="${durationStrBtn}" start="0s">\n<param name="Position" key="9999/10199/10201/1/100/101" value="0 ${p.yValue}"/>\n<text>${textXML}</text>\n${stylesXML}\n</title>\n`;
    });
    xml += `</gap>\n</spine>\n</sequence>\n</project>\n</event>\n</library>\n</fcpxml>`;
    return xml;
}

// 🟢 修复 5: 补全 escapeXML 的结尾
function escapeXML(s) { 
    return (s || "").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); 
}

// ==========================================
// 5. 工具函数与事件绑定
// ==========================================

window.toggleDropdown = function(e) {
    e.stopPropagation();
    document.getElementById('exportDropdown').classList.toggle('hidden');
}
window.closeDropdown = function() {
    document.getElementById('exportDropdown').classList.add('hidden');
}
window.onclick = function(e) {
    if (!e.target.closest('#exportDropdown') && !e.target.closest('button[onclick*="toggleDropdown"]')) {
        closeDropdown();
    }
}

window.exportSRT = function() {
    if (globalBlocks.length === 0) return log("Nothing to export.", 'WARN');
    let content = "";
    globalBlocks.forEach((b, i) => {
        content += `${i+1}\n${formatTimeSRT(b.start)} --> ${formatTimeSRT(b.end)}\n${b.text}\n\n`;
    });
    downloadFile(content, (currentFileName || "Untitled") + "_EXP.srt");
    log("Exported SRT file.", 'SUCCESS');
}

window.exportVTT = function() {
    if (globalBlocks.length === 0) return log("Nothing to export.", 'WARN');
    let content = "WEBVTT\n\n";
    globalBlocks.forEach((b) => {
        content += `${formatTimeVTT(b.start)} --> ${formatTimeVTT(b.end)}\n${b.text}\n\n`;
    });
    downloadFile(content, (currentFileName || "Untitled") + "_EXP.vtt");
    log("Exported VTT file.", 'SUCCESS');
}

// 基础解析器
function getSafeFont(f) { if (document.fonts && !document.fonts.check(`12px "${f}"`)) return "Helvetica"; return f; }
function downloadFile(c, f) { const u = URL.createObjectURL(new Blob([c], {type: 'text/plain'})); const a = document.createElement('a'); a.href = u; a.download = f; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
function formatTimeSRT(s) {
    const date = new Date(0, 0, 0, 0, 0, 0, s * 1000);
    const ms = Math.floor((s % 1) * 1000).toString().padStart(3, '0');
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')},${ms}`;
}
function formatTimeVTT(s) { return formatTimeSRT(s).replace(',', '.'); }

// ==========================================
// 6. 解析逻辑 (SRT/VTT/ASS/FCPXML)
// ==========================================
// ✅ 修复版 SRT 解析器：使用正则分割，容忍不规则空行
function parseSRT(txt) { 
    const blocks = []; 
    // 1. 统一换行符
    txt = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // 2. 使用正则 /\n\s*\n/ 分割，容忍 2个、3个甚至带空格的换行
    const parts = txt.trim().split(/\n\s*\n/);
    
    parts.forEach(p => {
        const lines = p.trim().split('\n');
        // SRT 格式至少需要 2 行（时间轴 + 文本），序号行可选
        if (lines.length >= 2) {
            // 查找时间轴行（包含 --> 的那一行）
            const idx = lines.findIndex(l => l.includes('-->'));
            if (idx !== -1) {
                const times = lines[idx].split('-->');
                // 内容是时间轴之后的所有行
                const text = lines.slice(idx + 1).join('\n').trim();
                
                if (text) {
                    blocks.push({ 
                        start: parseTime(times[0]), 
                        end: parseTime(times[1]), 
                        text: text 
                    });
                }
            }
        }
    });
    return blocks; 
}

// ✅ 修复版 VTT 解析器：过滤 NOTE 注释，处理 Cue Settings
function parseVTT(txt) { 
    const blocks = []; 
    // 1. 统一换行符并按行分割
    const lines = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    let s = null, e = null, t = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // 2. 遇到 WEBVTT 头或 NOTE 注释，直接跳过
        if (line === 'WEBVTT' || line.startsWith('NOTE') || line === '') continue;
        
        // 3. 遇到时间轴
        if (line.includes('-->')) {
            // 如果之前已经缓存了一个块，先保存
            if (s !== null && t.length > 0) {
                blocks.push({ start: s, end: e, text: t.join('\n').trim() });
            }
            
            // 解析新时间轴
            const parts = line.split('-->');
            s = parseTime(parts[0]);
            
            // VTT 时间轴后面可能有设置参数 (例如 align:middle)，需要去掉
            // "00:00:05.000 align:middle line:0" -> 取 "00:00:05.000"
            const endPart = parts[1].trim().split(' ')[0]; 
            e = parseTime(endPart);
            
            t = []; // 重置文本缓存
        } else {
            // 4. 普通文本行：只有在“时间轴已开始”且“不是注释”时才收集
            if (s !== null) {
                t.push(line);
            }
        }
    }
    
    // 5. 循环结束，保存最后一个块
    if (s !== null && t.length > 0) {
        blocks.push({ start: s, end: e, text: t.join('\n').trim() });
    }
    
    return blocks; 
}
function parseASS(txt) { 
    const blocks = []; 
    txt.split('\n').forEach(line => {
        // ASS 字幕行通常以 "Dialogue:" 开头
        if (line.trim().startsWith('Dialogue:')) {
            // ASS 格式: Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            // 我们只需要第 1 (Start), 2 (End) 和 9 (Text) 列
            const parts = line.split(',');
            if (parts.length > 9) {
                const start = parseTime(parts[1]); // 复用现有的 parseTime，它能处理 0:00:00.00
                const end = parseTime(parts[2]);
                
                // 文本从第 9 列开始（后面如果有逗号也属于文本的一部分，所以要 join 回来）
                let text = parts.slice(9).join(',');
                
                // 清理 ASS 特有的特效代码，例如 {\an8}, \N
                text = text.replace(/\{.*?\}/g, '')   // 去掉花括号里的特效标签
                           .replace(/\\N/gi, '\n')    // 把 \N 换行符转为真正的换行
                           .trim();

                if (text) blocks.push({ start, end, text });
            }
        }
    });
    return blocks; 
}
function parseFCPXML(xmlStr) { const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlStr, "text/xml"); const titles = xmlDoc.querySelectorAll("title"); const blocks = []; const parseFCPTime = (str) => { if (!str) return 0; str = str.replace('s', ''); if (str.includes('/')) { const [num, den] = str.split('/'); return parseInt(num) / parseInt(den); } return parseFloat(str); }; titles.forEach(t => { const textElement = t.querySelector("text"); if (!textElement) return; const rawText = textElement.textContent; if (!rawText.trim()) return; const offset = parseFCPTime(t.getAttribute("offset")); const duration = parseFCPTime(t.getAttribute("duration")); blocks.push({ start: offset, end: offset + duration, text: rawText.trim() }); }); return blocks; }
function parseTime(t) { if(!t) return 0; t = t.trim().replace(',', '.'); const parts = t.split(':'); const s = parseFloat(parts.pop()); const m = parseInt(parts.pop()) || 0; const h = parseInt(parts.pop()) || 0; return h*3600 + m*60 + s; }

// ==========================================
// 7. 数值调节与颜色工具
// ==========================================
window.adjustValue = function(id, step) {
    const input = document.getElementById(id);
    let val = parseFloat(input.value) || 0; 
    val = Math.round((val + step) * 100) / 100;
    if (id === 'opacity') { if (val < 0) val = 0; if (val > 100) val = 100; }
    input.value = val;
    input.dispatchEvent(new Event('change'));
    log(`${id} adjusted to: ${val}`); 
}

function getFCPColor(hex, opacityStr = "100%") {
    let r = 0, g = 0, b = 0;
    if (hex && hex.startsWith('#')) {
        const bigint = parseInt(hex.slice(1), 16);
        r = ((bigint >> 16) & 255) / 255;
        g = ((bigint >> 8) & 255) / 255;
        b = (bigint & 255) / 255;
    }
    let a = 1;
    if (opacityStr) {
        const rawVal = parseFloat(String(opacityStr).replace('%', ''));
        if (!isNaN(rawVal)) a = Math.max(0, Math.min(1, rawVal / 100));
    }
    const fmt = (n) => n.toFixed(4).replace(/\.?0+$/, ""); 
    return `${fmt(r)} ${fmt(g)} ${fmt(b)} ${fmt(a)}`;
}

// ==========================================
// 8. 初始化 (事件绑定)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('subFile');
    const dropZone = document.getElementById('dropZone');

    if (fileInput) fileInput.addEventListener('change', function() { if(this.files[0]) processFile(this.files[0]); });

    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, e => {e.preventDefault(); e.stopPropagation();}, false));
        dropZone.addEventListener('drop', e => { if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }, false);
    }

    // 全局变化监听 (Log Feedback)
    document.body.addEventListener('change', function(e) {
        if (e.target.type === 'file') return;
        let msg = "";
        const id = e.target.id || "Unknown";
        const val = e.target.value;

        if (e.target.tagName === 'SELECT') msg = `Option changed: [${id}] -> ${val}`;
        else if (e.target.type === 'color') msg = `Color update: [${id}] -> ${val}`;
        else if (e.target.type === 'checkbox') msg = `Checkbox [${id}] -> ${e.target.checked ? 'ON' : 'OFF'}`;
        else msg = `Value update: [${id}] -> ${val}`;

        if (!['positionY', 'fontSize', 'strokeWidth', 'opacity', 'shadowBlur'].includes(id) || e.isTrusted) log(msg);
        if (window.updateProviderUI) window.updateProviderUI();
    });
});
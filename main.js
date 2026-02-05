// 1. Tailwind 配置 (保留在最上方)
tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['"JetBrains Mono"', 'monospace'] },
            colors: {
                gray: { 750: '#2d2d2d', 850: '#1e1e1e', 900: '#18181b', 950: '#09090b' },
                primary: { 500: '#3b82f6', 600: '#2563eb' }
            }
        }
    }
}

// 2. 业务逻辑 (从 HTML 底部剪切过来的代码)
// ==========================================

// 日志功能
function log(msg, type = 'INFO') {
    const consoleDiv = document.getElementById('consoleLog');
    if (!consoleDiv) return; // 防止页面未加载完成报错
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

let globalBlocks = []; let isBilingualMode = false;
// 注意：这里我们稍后在 DOMContentLoaded 事件中绑定监听器，防止找不到元素

// 🔄 升级版 processFile：支持异步等待编码识别
async function processFile(file) {
    log(`Reading file: ${file.name}`);
    const ext = file.name.split('.').pop().toLowerCase();
    
    try {
        // 1. 调用万能解码器获取内容 (不管是 GBK 还是 UTF-8，这里拿到的都是标准文本)
        const content = await readFileAutoDetect(file);

        // 2. 开始解析
        if (ext === 'srt') globalBlocks = parseSRT(content);
        else if (ext === 'vtt') globalBlocks = parseVTT(content);
        else if (ext === 'ass' || ext === 'ssa') globalBlocks = parseASS(content);
        else if (ext === 'fcpxml' || ext === 'xml') globalBlocks = parseFCPXML(content);
        else throw new Error("Unsupported format");
        
        if(globalBlocks.length === 0) throw new Error("Empty content");
        
        // 3. 排序与更新 UI
        globalBlocks.sort((a, b) => a.start - b.start);
        log(`Parsed ${globalBlocks.length} subtitles.`, 'SUCCESS');
        
        const fileInfo = document.getElementById('fileInfo');
        fileInfo.innerText = file.name; 
        fileInfo.classList.remove('hidden');
        isBilingualMode = false;

    } catch (err) { 
        log(`Error: ${err.message}`, 'ERR'); 
        console.error(err);
    }
}

// 将全局函数挂载到 window 对象上，以便 HTML 中的 onclick 可以调用
window.setPos = function(val, btn) {
    document.getElementById('yValue').value = val;
    document.querySelectorAll('.pos-btn').forEach(b => { 
        b.classList.remove('bg-gray-600', 'text-white', 'shadow-sm', 'active'); 
        b.classList.add('text-gray-400', 'hover:text-white'); 
    });
    btn.classList.remove('text-gray-400', 'hover:text-white'); 
    btn.classList.add('bg-gray-600', 'text-white', 'shadow-sm', 'active');
    log(`Position set to ${val}`);
}

window.processWithAI = async function() {
    // 1. 获取界面元素
    const apiKey = document.getElementById('apiKey').value.trim();
    const mode = document.getElementById('aiMode').value;
    const selectedModel = document.getElementById('modelSelect').value;
    const btnAI = document.getElementById('btnAI');
    const pFill = document.getElementById('progressFill');
    const progressBar = document.getElementById('progressBar');

    // 2. 基础检查
    if (globalBlocks.length === 0) return log("请先导入字幕文件。", 'WARN');
    // 如果是云端模型且没填 Key，报错 (Qwen/Ollama 不需要 Key)
    if (!apiKey && !selectedModel.toLowerCase().includes("qwen") && !selectedModel.toLowerCase().includes("ollama")) {
        return log("使用云端模型需要填写 API Key。", 'WARN');
    }

    // 3. 智能 API 地址切换 (防止 localhost 报错)
    let apiBase = "https://api.deepseek.com/v1";
    // 逻辑：只有明确包含 local/ollama，或者包含 qwen 但不是 deepseek 时，才切本地
    if (selectedModel.includes("local") || selectedModel.includes("ollama") || (selectedModel.includes("qwen") && !selectedModel.includes("deepseek"))) {
        apiBase = "http://localhost:11434/v1";
        console.log("🖥️ 切换到本地模式 (Ollama)");
    }

    // 4. 锁定按钮，开始运行
    const originalBtnText = btnAI.innerHTML;
    btnAI.innerHTML = `Running...`; 
    btnAI.disabled = true; 
    progressBar.classList.remove('hidden');
    log(`开始 AI 任务: ${mode}...`);

    // 5. 定义超级严格的 System Prompt (针对润色优化)
    let systemPrompt = "";
    if (mode === "bilingual") {
        systemPrompt = `你是一个专业的字幕翻译工具。接收中文文本数组，返回英文翻译数组。
要求：
1. 仅返回一个纯 JSON 字符串数组 (Array of Strings)。
2. 数组长度必须与输入数组长度完全一致 (一一对应)。
3. 严禁输出任何解释、Markdown 代码块或额外文本。
4. 确保 JSON 格式合法（双引号需转义）。`;
    } else {
        // 润色模式专用 Prompt
        systemPrompt = `你是一个资深的字幕润色专家。请优化输入的字幕文本，使其更通顺、自然、符合口语习惯。
核心要求 (Deadly Strict):
1. 你必须且只能返回一个纯 JSON 字符串数组 (Array of Strings)。
2. 数组长度必须与输入数组长度完全一致。
3. 严禁在 JSON 前后添加任何文字（如"好的"、"如下"、"Output:"等）。
4. 严禁使用 Markdown 代码块。
5. 必须是有效的 JSON 格式。`;
    }

    const isR1 = selectedModel.includes("reasoner"); 
    const BATCH_SIZE = 10; // 批处理大小

    try {
        for (let i = 0; i < globalBlocks.length; i += BATCH_SIZE) {
            const batch = globalBlocks.slice(i, i + BATCH_SIZE);
            const sourceTexts = batch.map(b => b.text);
            
            // 构造请求体
            let requestBody = { 
                model: selectedModel, 
                messages: [
                    { role: "system", content: systemPrompt }, 
                    { role: "user", content: JSON.stringify(sourceTexts) }
                ], 
                temperature: 0.1 
            };
            
            // 如果支持 JSON 模式就强制开启 (R1 和本地模型除外)
            if (!isR1 && !apiBase.includes("localhost")) {
                requestBody.response_format = { type: "json_object" };
            }

            // 发起请求
            const response = await fetch(`${apiBase}/chat/completions`, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${apiKey}` 
                }, 
                body: JSON.stringify(requestBody) 
            });

            if (!response.ok) throw new Error(`HTTP ${response.status} - 接口请求失败`);
            
            const data = await response.json();
            
            // 6. 获取原始回复
            let aiRaw = data.choices[0].message.content;
            
            // 🛠️ 强力清洗 (Deep Clean)
            // 去掉 <think> 思考过程
            aiRaw = aiRaw.replace(/<think>[\s\S]*?<\/think>/gi, "");
            // 去掉 Markdown 代码块符号 ```json 和 ```
            aiRaw = aiRaw.replace(/```json/gi, "").replace(/```/g, "");
            // 去掉可能存在的 "Output:" 等前缀
            aiRaw = aiRaw.trim();

            let translatedArray = [];
            
            // 7. 尝试解析
            try {
                // 寻找最外层的方括号 []
                const startIdx = aiRaw.indexOf('['); 
                const endIdx = aiRaw.lastIndexOf(']');
                
                if (startIdx !== -1 && endIdx !== -1) {
                    // 只截取方括号中间的内容进行解析
                    const jsonStr = aiRaw.substring(startIdx, endIdx + 1);
                    translatedArray = JSON.parse(jsonStr);
                } else {
                    // 兜底尝试：有时候 AI 会返回 { "result": [...] }
                    const obj = JSON.parse(aiRaw); 
                    // 找对象里是不是藏着数组
                    for (let k in obj) { 
                        if (Array.isArray(obj[k])) { translatedArray = obj[k]; break; } 
                    }
                }
            } catch (parseErr) {
                // 🚨 如果还是报错，把 AI 回复的内容打印出来，方便捉虫
                console.error("❌ JSON 解析失败，AI 返回的原始内容如下:", aiRaw);
                log(`第 ${i/BATCH_SIZE + 1} 批次解析失败 (看控制台详情)`, 'ERR');
                continue; // 跳过这一批，继续下一批
            }

            // 8. 回填数据
            batch.forEach((block, idx) => {
                const trans = translatedArray[idx];
                if (trans) { 
                    if (mode === "bilingual") { 
                        block.text = `${block.text}\n${trans}`; 
                        isBilingualMode = true; 
                    } else { 
                        block.text = trans; // 润色模式直接覆盖
                    } 
                }
            });

            // 更新进度条
            const pct = Math.round(((i + BATCH_SIZE) / globalBlocks.length) * 100);
            pFill.style.width = `${Math.min(pct, 100)}%`; 
        }
        log("AI 处理全部完成！", 'SUCCESS');
    } catch (err) { 
        log(`错误: ${err.message}`, 'ERR'); 
        console.error(err);
    } finally { 
        // 恢复按钮
        btnAI.innerHTML = originalBtnText; 
        btnAI.disabled = false; 
    }
}

window.exportFCPXML = function() {
    if (globalBlocks.length === 0) return log("Nothing to export.", 'WARN');
    const fontName = getSafeFont(document.getElementById('fontName').value);
    const fileInput = document.getElementById('subFile'); // 这里重新获取
    let fileName = fileInput.files[0] ? fileInput.files[0].name.replace(/\.[^/.]+$/, "") : "Untitled";
    const params = { fileName: fileName, fontName: fontName, fontSize: document.getElementById('fontSize').value, fontColor: hexToRgb(document.getElementById('fontColor').value), strokeColor: hexToRgb(document.getElementById('strokeColor').value), strokeWidth: document.getElementById('strokeWidth').value, yValue: document.getElementById('yValue').value };
    const xml = generateXML(globalBlocks, params);
    const suffix = isBilingualMode ? "_DUAL" : "_SUB";
    downloadFile(xml, params.fileName + suffix + '.fcpxml');
    log(`Exported file: ${params.fileName}${suffix}.fcpxml`, 'SUCCESS');
}

// 解析器函数
function getSafeFont(f) { if (document.fonts && !document.fonts.check(`12px "${f}"`)) return "Helvetica"; return f; }
function hexToRgb(hex) { const r = parseInt(hex.slice(1, 3), 16)/255; const g = parseInt(hex.slice(3, 5), 16)/255; const b = parseInt(hex.slice(5, 7), 16)/255; return `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} 1`; }
function downloadFile(c, f) { const u = URL.createObjectURL(new Blob([c], {type: 'text/xml'})); const a = document.createElement('a'); a.href = u; a.download = f; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
function generateXML(blocks, p) { 
    const fps = 30; const totalFrames = Math.ceil((blocks[blocks.length-1].end + 5) * fps); const durationStr = `${totalFrames * 100}/3000s`;
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n<resources>\n<format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>\n<effect id="fx_custom" name="Custom" uid=".../Titles.localized/Build In:Out.localized/Custom.localized/Custom.moti"/>\n</resources>\n<library>\n<event name="Subtitle Import">\n<project name="${escapeXML(p.fileName)}">\n<sequence format="r1" duration="${durationStr}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n<spine>\n<gap name="Gap" offset="0s" duration="${durationStr}" start="0s">\n`;
    blocks.forEach((block, index) => {
        const sFrame = Math.round(block.start * fps); const eFrame = Math.round(block.end * fps); const durFrame = (eFrame <= sFrame ? sFrame + 1 : eFrame) - sFrame;
        let textXML = ""; let stylesXML = "";
        if (isBilingualMode && block.text.includes('\n')) {
            const lines = block.text.split('\n'); const cnText = lines[0]; const enText = lines.slice(1).join(' ');
            textXML = `<text-style ref="ts_cn_${index}">${escapeXML(cnText)}</text-style><text-style ref="ts_en_${index}">&#10;${escapeXML(enText)}</text-style>`;
            stylesXML = `<text-style-def id="ts_cn_${index}"><text-style font="${p.fontName}" fontSize="${p.fontSize}" fontFace="Regular" fontColor="${p.fontColor}" strokeColor="${p.strokeColor}" strokeWidth="${p.strokeWidth}" alignment="center"/></text-style-def><text-style-def id="ts_en_${index}"><text-style font="${p.fontName}" fontSize="${Math.round(p.fontSize / 2)}" fontFace="Regular" fontColor="${p.fontColor}" strokeColor="${p.strokeColor}" strokeWidth="${p.strokeWidth}" alignment="center"/></text-style-def>`;
        } else {
            textXML = `<text-style ref="ts_${index}">${escapeXML(block.text)}</text-style>`;
            stylesXML = `<text-style-def id="ts_${index}"><text-style font="${p.fontName}" fontSize="${p.fontSize}" fontFace="Regular" fontColor="${p.fontColor}" strokeColor="${p.strokeColor}" strokeWidth="${p.strokeWidth}" alignment="center"/></text-style-def>`;
        }
        xml += `<title name="Sub ${index}" lane="1" offset="${sFrame * 100}/3000s" ref="fx_custom" duration="${durFrame * 100}/3000s" start="0s">\n<param name="Position" key="9999/10199/10201/1/100/101" value="0 ${p.yValue}"/>\n<text>${textXML}</text>\n${stylesXML}\n</title>\n`;
    });
    xml += `</gap>\n</spine>\n</sequence>\n</project>\n</event>\n</library>\n</fcpxml>`;
    return xml;
}
function parseSRT(txt) { const blocks = []; txt.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n\n').forEach(p => { const lines = p.trim().split('\n'); if(lines.length >= 2) { const idx = lines.findIndex(l => l.includes('-->')); if(idx !== -1) { const times = lines[idx].split('-->'); const text = lines.slice(idx + 1).join('\n'); if(text) blocks.push({ start: parseTime(times[0]), end: parseTime(times[1]), text: text }); } } }); return blocks; }
function parseVTT(txt) { const blocks = []; const lines = txt.replace(/\r\n/g,'\n').split('\n'); let s=null, e=null, t=[]; lines.forEach(line => { if(line.includes('-->')) { if(s!==null && t.length) blocks.push({start:s, end:e, text:t.join('\n')}); const p = line.split('-->'); s=parseTime(p[0]); e=parseTime(p[1].split(' ')[0]); t=[]; } else if(line.trim() && s!==null && line !== 'WEBVTT') t.push(line); }); if(s!==null && t.length) blocks.push({start:s, end:e, text:t.join('\n')}); return blocks; }
function parseASS(txt) { return parseSRT(txt); } 
function parseFCPXML(xmlStr) { const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlStr, "text/xml"); const titles = xmlDoc.querySelectorAll("title"); const blocks = []; const parseFCPTime = (str) => { if (!str) return 0; str = str.replace('s', ''); if (str.includes('/')) { const [num, den] = str.split('/'); return parseInt(num) / parseInt(den); } return parseFloat(str); }; titles.forEach(t => { const textElement = t.querySelector("text"); if (!textElement) return; const rawText = textElement.textContent; if (!rawText.trim()) return; const offset = parseFCPTime(t.getAttribute("offset")); const duration = parseFCPTime(t.getAttribute("duration")); blocks.push({ start: offset, end: offset + duration, text: rawText.trim() }); }); return blocks; }
function parseTime(t) { if(!t) return 0; t = t.trim().replace(',', '.'); const parts = t.split(':'); const s = parseFloat(parts.pop()); const m = parseInt(parts.pop()) || 0; const h = parseInt(parts.pop()) || 0; return h*3600 + m*60 + s; }
function escapeXML(s) { return (s || "").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// 初始化：绑定事件
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('subFile');
    const dropZone = fileInput.closest('div'); // 找到父级容器作为拖拽区

    if (fileInput) {
        fileInput.addEventListener('change', function() { if(this.files[0]) processFile(this.files[0]); });
    }

    if (dropZone) {
        document.body.addEventListener('dragover', e => { e.preventDefault(); });
        document.body.addEventListener('drop', e => { e.preventDefault(); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });
    }
    
    // 清空日志按钮
    const clearBtn = document.querySelector('button[onclick*="innerHTML=\'\'"]');
    if(clearBtn) clearBtn.onclick = () => document.getElementById('consoleLog').innerHTML = '';
});
/**
 * 🕵️‍♂️ 万能文件读取器 (终极版)
 * 逻辑：尝试 UTF-8 -> 失败则尝试 GBK -> 失败则尝试 Big5 -> 兜底
 */
function readFileAutoDetect(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        // 关键：读取为二进制流，不要让浏览器自作主张
        reader.readAsArrayBuffer(file);
        
        reader.onload = (e) => {
            const buffer = e.target.result;
            
            // 1. 第一关：尝试标准 UTF-8 (严格模式)
            const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
            try {
                const text = utf8Decoder.decode(buffer);
                console.log("✅ 识别编码: UTF-8");
                resolve(text);
                return;
            } catch (err) {
                console.log("⚠️ 非 UTF-8，尝试 GBK...");
            }

            // 2. 第二关：尝试 GB18030 (中文简体通用，兼容 GBK/GB2312)
            const gbkDecoder = new TextDecoder('gb18030', { fatal: true });
            try {
                const text = gbkDecoder.decode(buffer);
                console.log("✅ 识别编码: GB18030 (中文简体)");
                resolve(text);
                return;
            } catch (err) {
                console.log("⚠️ 非 GBK，尝试 Big5...");
            }

            // 3. 第三关：尝试 Big5 (中文繁体)
            const big5Decoder = new TextDecoder('big5', { fatal: true });
            try {
                const text = big5Decoder.decode(buffer);
                console.log("✅ 识别编码: Big5 (中文繁体)");
                resolve(text);
                return;
            } catch (err) {
                console.warn("❌ 无法识别编码，尝试强制 UTF-8 读取");
                // 4. 最后的倔强：非严格模式读取
                const fallbackDecoder = new TextDecoder('utf-8');
                resolve(fallbackDecoder.decode(buffer));
            }
        };

        reader.onerror = () => reject("文件读取系统错误");
    });

}

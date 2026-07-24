const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

// ==========================================
// HTML -> pdfmake-konverterare för fri text (t.ex. köpeavtal/kommentarer) som
// numera kan innehålla enkel HTML från en contenteditable-editor (se settings.html).
// Ingen DOM/jsdom - en enkel regex/tokenizer anpassad efter vad vår egen editor
// faktiskt producerar (platta p/div/h1-h3/ul/ol-block, ej djupt nästlade element).
// ==========================================
function decodeHtmlEntities(str) {
    return str.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, '&');
}

// Plockar isär <b>/<strong>, <i>/<em>, <u> till en array av pdfmake-textruns.
// Övrig okänd markup i textsegmenten städas bort som en sista säkerhetsåtgärd.
function parseInlineHtml(html) {
    const tokens = html.split(/(<\/?(?:b|strong|i|em|u)[^>]*>)/gi);
    const runs = [];
    let bold = false, italics = false, underline = false;
    tokens.forEach(tok => {
        if (!tok) return;
        const tagMatch = tok.match(/^<(\/?)(\w+)[^>]*>$/);
        if (tagMatch) {
            const closing = tagMatch[1] === '/';
            const tagName = tagMatch[2].toLowerCase();
            if (tagName === 'b' || tagName === 'strong') bold = !closing;
            else if (tagName === 'i' || tagName === 'em') italics = !closing;
            else if (tagName === 'u') underline = !closing;
            return;
        }
        const text = decodeHtmlEntities(tok.replace(/<[^>]+>/g, ''));
        if (text === '') return;
        const run = { text };
        if (bold) run.bold = true;
        if (italics) run.italics = true;
        if (underline) run.decoration = 'underline';
        runs.push(run);
    });
    return runs;
}

function htmlBlockToNodes(tag, inner) {
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const fontSize = tag === 'h1' ? 20 : (tag === 'h2' ? 15 : 12);
        const runs = parseInlineHtml(inner);
        return [{ text: runs.length ? runs : '', fontSize, bold: true, margin: [0, 8, 0, 4] }];
    }
    if (tag === 'ul' || tag === 'ol') {
        const items = [];
        const liRegex = /<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi;
        let m;
        while ((m = liRegex.exec(inner)) !== null) {
            const runs = parseInlineHtml(m[1]);
            items.push({ text: runs.length ? runs : '' });
        }
        return items.length ? [{ [tag]: items, margin: [0, 2, 0, 6] }] : [];
    }
    // p / div: dela på <br> till rader inom samma stycke.
    const lines = inner.split(/<br\s*\/?>/gi);
    const textNode = [];
    lines.forEach((line, idx) => {
        if (idx > 0) textNode.push('\n');
        textNode.push(...parseInlineHtml(line));
    });
    return [{ text: textNode.length ? textNode : '', margin: [0, 0, 0, 6] }];
}

// Returnerar en array av pdfmake content-noder från en HTML-sträng (eller ren klartext).
function htmlToPdfmakeNodes(html) {
    if (!html) return [];
    const nodes = [];
    const blockRegex = /<(p|div|h1|h2|h3|ul|ol)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match; let matchedAny = false;
    while ((match = blockRegex.exec(html)) !== null) {
        matchedAny = true;
        nodes.push(...htmlBlockToNodes(match[1].toLowerCase(), match[2]));
    }
    if (!matchedAny) nodes.push(...htmlBlockToNodes('p', html)); // ren klartext/enstaka rad utan blocktaggar
    return nodes;
}

function downloadExternalImage(urlStr, destFolder) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(urlStr);
            const client = urlObj.protocol === 'https:' ? https : http;
            let ext = path.extname(urlObj.pathname).toLowerCase();
            if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) ext = '.jpg';
            const filename = 'dl_' + Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
            const filepath = path.join(destFolder, filename);

            client.get(urlStr, (response) => {
                if (response.statusCode === 200 || response.statusCode === 301 || response.statusCode === 302) {
                    const file = fs.createWriteStream(filepath);
                    file.on('error', () => resolve(null));
                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve('/uploads/' + filename); });
                } else resolve(null);
            }).on('error', () => resolve(null));
        } catch(e) { resolve(null); }
    });
}

function getExternalImageBase64(urlStr) {
    return new Promise((resolve) => {
        try {
            const client = urlStr.startsWith('https') ? https : http;
            client.get(urlStr, (response) => {
                if (response.statusCode === 200) {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
                } else resolve(null);
            }).on('error', () => resolve(null));
        } catch(e) { resolve(null); }
    });
}

// Bygger en pdfmake-bildcell (lokal fil eller extern URL, base64-inbäddad) från en ren image_url-sträng.
// Delad mellan produktbilder och bänkskivefärg-bilder i offert/köpeavtals-PDF:en.
async function buildPdfImageCell(imageUrl, size = 45) {
    const emptyCell = { text: '', alignment: 'center', margin: [0, 10] };
    if (!imageUrl) return emptyCell;
    let rawUrl = imageUrl.split('?')[0];
    if (rawUrl.startsWith('http')) {
        const base64 = await getExternalImageBase64(rawUrl);
        if (base64) { const mime = rawUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'; return { image: `data:${mime};base64,${base64}`, width: size, height: size, alignment: 'center', margin: [0, 5, 0, 5] }; }
        return emptyCell;
    }
    let cleanPath = rawUrl.startsWith('/') ? rawUrl.substring(1) : rawUrl; if (cleanPath.startsWith('public/')) cleanPath = cleanPath.substring(7);
    const fullImgPath = path.join(__dirname, '..', 'public', cleanPath);
    if (fs.existsSync(fullImgPath)) {
        const ext = path.extname(fullImgPath).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
            try { const mime = ext === '.png' ? 'image/png' : 'image/jpeg'; return { image: `data:${mime};base64,${fs.readFileSync(fullImgPath).toString('base64')}`, width: size, height: size, alignment: 'center', margin: [0, 5, 0, 5] }; } catch (e) {}
        }
    }
    return emptyCell;
}

// Bygger en bildbild med bevarat bildförhållande (t.ex. en skärmdump på en ritning) -
// till skillnad från buildPdfImageCell som alltid beskär till en fyrkant för tabellceller.
// Returnerar null (inte en tom cell) om ingen bild finns, så anroparen kan hoppa över
// hela blocket istället för att rendera ett tomt utrymme.
async function buildPdfHeroImageBlock(imageUrl, maxWidth = 480, maxHeight = 300) {
    if (!imageUrl) return null;
    let rawUrl = imageUrl.split('?')[0];
    let base64 = null, mime = 'image/jpeg';
    if (rawUrl.startsWith('http')) {
        base64 = await getExternalImageBase64(rawUrl);
        mime = rawUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
    } else {
        let cleanPath = rawUrl.startsWith('/') ? rawUrl.substring(1) : rawUrl; if (cleanPath.startsWith('public/')) cleanPath = cleanPath.substring(7);
        const fullImgPath = path.join(__dirname, '..', 'public', cleanPath);
        if (fs.existsSync(fullImgPath)) {
            const ext = path.extname(fullImgPath).toLowerCase();
            if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
                mime = ext === '.png' ? 'image/png' : 'image/jpeg';
                try { base64 = fs.readFileSync(fullImgPath).toString('base64'); } catch (e) {}
            }
        }
    }
    if (!base64) return null;
    return { image: `data:${mime};base64,${base64}`, fit: [maxWidth, maxHeight], alignment: 'center' };
}

module.exports = {
    decodeHtmlEntities,
    parseInlineHtml,
    htmlBlockToNodes,
    htmlToPdfmakeNodes,
    downloadExternalImage,
    getExternalImageBase64,
    buildPdfImageCell,
    buildPdfHeroImageBlock
};

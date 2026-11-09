import qrcode from 'qrcode-generator';

// Encode only serialized HTTP(S) links: percent encoding keeps the byte stream
// unambiguous, including supplementary Han characters in the shared query.
export function shareQrPixels(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('二维码仅支持网站链接');
    const text = url.href;
    if (text.length > 2048) throw new Error('链接太长，请复制链接');
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const quiet = 4;
    const scale = 8;
    const modules = qr.getModuleCount();
    const width = (modules + quiet * 2) * scale;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let row = 0; row < modules; row++) {
        for (let col = 0; col < modules; col++) {
            if (!qr.isDark(row, col)) continue;
            for (let y = 0; y < scale; y++) {
                for (let x = 0; x < scale; x++) {
                    const offset = (((row + quiet) * scale + y) * width + (col + quiet) * scale + x) * 4;
                    data[offset] = data[offset + 1] = data[offset + 2] = 0;
                }
            }
        }
    }
    return { data, width, height: width };
}

export function createShareQrImage(value) {
    const pixels = shareQrPixels(value);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = pixels.width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('二维码图片暂不可用');
    context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    const result = canvas.toDataURL('image/png');
    if (!result.startsWith('data:image/png;base64,')) throw new Error('二维码图片暂不可用');
    return result;
}

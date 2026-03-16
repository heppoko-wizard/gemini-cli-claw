'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log, randomId } = require('./utils');

/**
 * Utility to handle Base64 Data URIs (images) and save them to temporary files.
 */

const TEMP_MEDIA_PREFIX = 'gemini-media-';

/**
 * Decodes a Base64 data URI and saves it to a temp file.
 * Returns the absolute path to the created file.
 * 
 * Data URI format: data:[<mediatype>][;base64],<data>
 */
function saveBase64Image(dataUri) {
    try {
        const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
            log(`[media] ERROR: Invalid data URI format.`);
            return null;
        }

        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        // Determine extension from mimeType
        let ext = 'bin';
        if (mimeType === 'image/jpeg') ext = 'jpg';
        else if (mimeType === 'image/png') ext = 'png';
        else if (mimeType === 'image/gif') ext = 'gif';
        else if (mimeType === 'image/webp') ext = 'webp';

        const fileName = `${TEMP_MEDIA_PREFIX}${randomId()}.${ext}`;
        const filePath = path.join(os.tmpdir(), fileName);

        fs.writeFileSync(filePath, buffer);
        log(`[media] Saved Base64 image to: ${filePath} (${mimeType}, ${buffer.length} bytes)`);

        return filePath;
    } catch (e) {
        log(`[media] ERROR saving Base64 image: ${e.message}`);
        return null;
    }
}

/**
 * Cleanup old temporary media files.
 */
function cleanupTempMedia() {
    try {
        const tmpDir = os.tmpdir();
        const files = fs.readdirSync(tmpDir);
        let count = 0;
        for (const file of files) {
            if (file.startsWith(TEMP_MEDIA_PREFIX)) {
                fs.unlinkSync(path.join(tmpDir, file));
                count++;
            }
        }
        if (count > 0) log(`[media] Cleaned up ${count} temporary media files.`);
    } catch (e) {
        log(`[media] ERROR during cleanup: ${e.message}`);
    }
}

module.exports = {
    saveBase64Image,
    cleanupTempMedia
};

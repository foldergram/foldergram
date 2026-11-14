import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config/env.js';
function encryptionKey(): Buffer {
    const filename = process.env.IMMICH_ENCRYPTION_KEY_FILE || path.join(appConfig.dbDir, 'immich-encryption.key');
    if (!process.env.IMMICH_ENCRYPTION_KEY_FILE) {
        fs.mkdirSync(appConfig.dbDir, { recursive: true });
        try {
            fs.writeFileSync(filename, randomBytes(32), { flag: 'wx', mode: 0o600 });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
    }
    const key = fs.readFileSync(filename);
    if (key.length !== 32)
        throw new Error('Immich encryption key file must contain exactly 32 bytes. Restore the persistent key file.');
    return key;
}
export function encryptCredential(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function decryptCredential(value: string): string {
    try {
        const bytes = Buffer.from(value, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
    catch {
        throw new Error('Cannot decrypt Immich credential. Restore the encryption key file or enter the API key again.');
    }
}

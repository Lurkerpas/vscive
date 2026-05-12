import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
    if (crcTable) {
        return crcTable;
    }
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        crcTable[index] = value >>> 0;
    }
    return crcTable;
}

function crc32(buffer: Buffer): number {
    let value = 0xffffffff;
    const table = getCrcTable();
    for (const byte of buffer) {
        value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

export function encodePngRgba(width: number, height: number, pixels: Uint8Array): Buffer {
    assert.equal(pixels.length, width * height * 4);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const rowStride = width * 4 + 1;
    const raw = Buffer.alloc(rowStride * height);
    for (let y = 0; y < height; y++) {
        const rowOffset = y * rowStride;
        raw[rowOffset] = 0;
        const srcStart = y * width * 4;
        pixels.subarray(srcStart, srcStart + width * 4).forEach((value, index) => {
            raw[rowOffset + 1 + index] = value;
        });
    }

    return Buffer.concat([
        PNG_SIGNATURE,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', deflateSync(raw)),
        makeChunk('IEND', Buffer.alloc(0)),
    ]);
}

export function parsePng(buffer: Buffer): { width: number; height: number; pixels: Buffer } {
    assert.ok(buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));

    let offset = PNG_SIGNATURE.length;
    let width = 0;
    let height = 0;
    const idatChunks: Buffer[] = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const data = buffer.subarray(dataStart, dataEnd);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
        } else if (type === 'IDAT') {
            idatChunks.push(data);
        } else if (type === 'IEND') {
            break;
        }

        offset = dataEnd + 4;
    }

    const raw = inflateSync(Buffer.concat(idatChunks));
    const rowStride = width * 4 + 1;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const rowOffset = y * rowStride;
        assert.equal(raw[rowOffset], 0);
        raw.copy(pixels, y * width * 4, rowOffset + 1, rowOffset + rowStride);
    }

    return { width, height, pixels };
}
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32 } from "node:zlib";

// Packs keys-extension/ into web/public/keys/zotify-keys.zip, which keys.zotify.app links to, as part of npm run build.
// Files are stored uncompressed: the extension is a few kilobytes, and that keeps this to a plain zip writer with no packages

const SOURCE = "keys-extension";
const OUTPUT = "web/public/keys/zotify-keys.zip";

function filesIn(dir: string): string[] {
    return readdirSync(dir).filter(name => !name.startsWith(".")).sort().flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? filesIn(path) : [path];
    });
}

const locals: Buffer[] = [];
const centrals: Buffer[] = [];
let offset = 0;

for (const path of filesIn(SOURCE)) {
    // Inside a zotify-keys folder, ready for Load unpacked once it's unzipped
    const name = Buffer.from(`zotify-keys/${relative(SOURCE, path).split("\\").join("/")}`);
    const data = readFileSync(path);
    const crc = crc32(data);

    const header = (signature: number, size: number) => {
        const buffer = Buffer.alloc(size);
        buffer.writeUInt32LE(signature, 0);
        return buffer;
    };

    // Version needed, stored (no compression), and a fixed date (1 Jan 2025), so the zip only changes when the files do
    const local = header(0x04034b50, 30);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0x5a21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = header(0x02014b50, 46);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x5a21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
}

const directory = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync("web/public/keys", { recursive: true });
writeFileSync(OUTPUT, Buffer.concat([...locals, directory, end]));
console.log(`Packed ${centrals.length / 2} files into ${OUTPUT}`);

/** Build user-installable connector ZIP files for the Cloud app at build time.
 * No GitHub Actions, external ZIP utility, runtime network or new dependency.
 * Inputs are fixed, committed connector sources. Reproducible ZIPs.
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=path.join(root,"integrations");
const output=path.join(root,"apps/cloud/public/connectors");
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0;}
function crc32(data){let c=0xffffffff;for(const byte of data)c=crcTable[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;}
async function filesUnder(directory,prefix){
  const result=[];
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith(".")) continue;
    const full=path.join(directory,entry.name);
    if(entry.isDirectory()) result.push(...await filesUnder(full,prefix+"/"+entry.name));
    else if(entry.isFile() && /\.(?:php|yml|module)$/.test(entry.name)) {
      const data=await readFile(full);
      if(data.length>1024*1024)throw new Error("Unexpectedly large connector source");
      result.push({name:prefix+"/"+entry.name,data});
    }else throw new Error("Unexpected connector entry: "+entry.name);
  }
  return result;
}
function zip(entries){
  const local=[],central=[];let offset=0;
  for(const {name,data} of entries){
    const filename=Buffer.from(name,"utf8");
    if(filename.length>65535||data.length>0xffffffff)throw new Error("Invalid archive entry");
    const compressed=deflateRawSync(data,{level:9});
    const crc=crc32(data);
    const common=Buffer.concat([u16(0x0800),u16(8),u16(0),u16(0x0021),u32(crc),u32(compressed.length),u32(data.length),u16(filename.length),u16(0)]);
    const localHeader=Buffer.concat([u32(0x04034b50),u16(20),common,filename]);
    local.push(localHeader,compressed);
    const centralHeader=Buffer.concat([u32(0x02014b50),u16(20),u16(20),common,u16(0),u16(0),u16(0),u32(0),u32(offset),filename]);
    central.push(centralHeader);
    offset+=localHeader.length+compressed.length;
  }
  const directory=Buffer.concat(central);
  const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(directory.length),u32(offset),u16(0)]);
  return Buffer.concat([...local,directory,end]);
}
await mkdir(output,{recursive:true});
for(const [cms,name] of [["wordpress","ship-check-connector"],["drupal","ship_check_connector"]]){
  const entries=await filesUnder(path.join(source,cms,name),name);
  if(!entries.length)throw new Error("No connector files for "+cms);
  const file=path.join(output,"ship-check-"+cms+"-connector.zip");
  await writeFile(file,zip(entries));
  console.log("Packaged "+cms+" connector ("+entries.length+" files)");
}

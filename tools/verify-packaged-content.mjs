import asar from '@electron/asar';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const archive=process.argv[2]??'dist/win-unpacked/resources/app.asar';
const packed=JSON.parse(asar.extractFile(archive,'package.json').toString());
const source=JSON.parse(await readFile('package.json','utf8'));
assert.equal(packed.version,source.version);assert.equal(packed.main,source.main);
let checked=0;
async function verify(dir){for(const e of await readdir(dir,{withFileTypes:true})){
 const path=join(dir,e.name);if(e.isDirectory())await verify(path);else{
  assert.deepEqual(asar.extractFile(archive,path),await readFile(path),'Packaged bytes mismatch: '+path);checked++;
 }
}}
await verify('out');await mkdir('artifacts',{recursive:true});
const report={verifiedAt:new Date().toISOString(),version:source.version,files:checked,asarSha256:createHash('sha256').update(await readFile(archive)).digest('hex')};
await writeFile('artifacts/packaged-content.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

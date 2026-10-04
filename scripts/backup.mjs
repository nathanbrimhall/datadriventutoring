import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
const dataDir=resolve(process.env.DATA_DIR||'.data');
const source=join(dataDir,'tutoring.sqlite');
if(!existsSync(source))throw new Error('No database found. Start ProgressPoint first.');
const directory=resolve(process.argv[2]||join(dataDir,'backups'));
mkdirSync(directory,{recursive:true});
const output=join(directory,'progresspoint-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
if(existsSync(output))throw new Error('Backup destination already exists.');
const db=new DatabaseSync(source,{readOnly:true});
try {await backup(db,output);console.log('Consistent database backup saved to '+output);}
finally {db.close();}

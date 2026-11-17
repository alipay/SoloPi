#!/usr/bin/env node
// Local operator export; never reads application configuration or the database.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {configureDiagnostics,diagnosticBundle} from '../src/diagnostics.mjs';
const [directory,output]=process.argv.slice(2);
if(!directory||!output){console.error('Usage: node scripts/export-diagnostics.mjs <diagnostics-directory> <new-output.json.gz>');process.exit(2);}
configureDiagnostics(directory);const data=diagnosticBundle();writeFileSync(resolve(output),data,{flag:'wx',mode:0o600});console.log(JSON.stringify({success:true,bytes:data.length,format:'solopi-server-diagnostics-v1'}));

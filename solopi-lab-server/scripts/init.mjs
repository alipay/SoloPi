#!/usr/bin/env node
// Initialize a new deployment with the existing database and admin contracts.
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,migrate} from '../src/db.mjs';
import {adminInit} from '../src/admincli.mjs';

export function initializeServer(directory,{orgKey='my-lab',projectKey='default'}={}) {
  const root=resolve(directory);
  if(existsSync(root))throw Error('Initialization requires a new data directory; existing data was not changed');
  if(!orgKey.trim()||!projectKey.trim())throw Error('Organization and project names are required');
  mkdirSync(root,{mode:0o700});
  const database=join(root,'lab.db');
  const db=openDatabase(database);
  try {
    migrate(db);
    const identity=adminInit(db,{orgKey,projectKey,label:'bootstrap'});
    writeFileSync(join(root,'admin.token'),identity.token+'\n',{mode:0o600,flag:'wx'});
    writeFileSync(join(root,'scope.json'),JSON.stringify({orgId:identity.orgId,projectId:identity.projectId},null,2)+'\n',{mode:0o600,flag:'wx'});
    return {success:true,directory:root,database,tokenFile:join(root,'admin.token'),mapFile:join(root,'scope.json'),credentialExpiresAt:identity.expiresAt};
  } finally {db.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),values={};
  for(let i=0;i<args.length;i+=2){if(!['--data-dir','--org','--project'].includes(args[i])||!args[i+1])throw Error('Usage: node lab-server/scripts/init.mjs --data-dir <new-directory> [--org <name>] [--project <name>]');values[args[i]]=args[i+1];}
  if(!values['--data-dir'])throw Error('--data-dir is required; existing deployments are never initialized automatically');
  console.log(JSON.stringify(initializeServer(values['--data-dir'],{orgKey:values['--org'],projectKey:values['--project']})));
}

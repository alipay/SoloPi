"""Isolated subprocess contract fixture; does not import SoloPi or access devices."""
import json
import sys
from pathlib import Path
root = Path(sys.argv[1]); root.mkdir(exist_ok=True)
args = sys.argv[2:]
with (root / 'calls.jsonl').open('a') as log: log.write(json.dumps(args) + '\n')
if args[:3] == ['tools','call','submit_task']:
    payload = json.loads(Path(args[args.index('--file') + 1]).read_text())
    task = {'id': 'fixture-task', 'status': 'success', 'finishedAt': '2026-11-02T00:00:00Z',
            'total':len(payload['caseIds']), 'completed':len(payload['caseIds']), 'devices':payload['devices'], 'cases': []}
    for case_id in payload['caseIds']:
        file = root / (case_id + '.log'); file.write_text('isolated test evidence for ' + case_id)
        task['cases'].append({'caseId':case_id,'status':'success','artifacts':{'logs':[{'path':str(file)}]}})
    (root / 'task.json').write_text(json.dumps(task))
    print(json.dumps({'success':True,'submitted':True,'taskId':task['id']}))
elif args[:2] == ['tasks','show']:
    print(json.dumps({'success':True,'task':json.loads((root / 'task.json').read_text())}))
elif args[:2] == ['tasks','stop']:
    task = json.loads((root / 'task.json').read_text()); task['status']='stopped'
    (root / 'task.json').write_text(json.dumps(task)); print(json.dumps({'success':True,'taskId':task['id']}))
else:
    print(json.dumps({'success':False,'error':'Unsupported fixture command'})); sys.exit(1)

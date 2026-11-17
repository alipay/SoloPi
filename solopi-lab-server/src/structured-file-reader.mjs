import {readFileSync, realpathSync, mkdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import boundaries from './desktop-agent/workspace-policy.js';
import evidence from './desktop-agent/evidence-projection.js';

// Reuse the existing projector; normal attachment reads keep their native
// paging/binary behavior. Parsing happens on the host, not in model context.
export function structuredFileReader(tool, {workspace, project = evidence.project}) {
  return {...tool,
    description: tool.description + ' JSON文件可用jsonPointers数组直接批量取字段，无需先分页或生成解析脚本。例如{"path":"result.json","jsonPointers":["/result/case/steps"]}。JSON字符串可继续逐层定位：文件含{"stdout":"{\"revision\":\"v1\"}"}时用["/stdout/revision"]，必须保留stdout这一层。路径针对文件实际JSON，不猜包装字段；返回sourceStructure辅助定位。大字段完整保存在projectionPath，字段未命中只表示该路径不存在。普通文本仍使用offset/limit和nextOffset。',
    schema: {...tool.schema, properties: {...tool.schema.properties,
      jsonPointers: {type:'array', description:'JSON Pointer相对文件根；嵌套JSON字符串逐层穿透但不能省略外层键。', minItems:1, maxItems:20, items:{type:'string', maxLength:1000}}
    }},
    reference: tool.reference ? args => {
      const source=tool.reference(args);
      if (!source || args.jsonPointers === undefined) return source;
      return {...source, key:createHash('sha256').update(JSON.stringify([source.key,args.jsonPointers])).digest('hex')};
    } : undefined,
    execute: async (args, execution) => {
      if (args.jsonPointers === undefined) return tool.execute(args, execution);
      const root = realpathSync(workspace()), file = resolve(root, args.path);
      const authorize = boundaries.workspacePolicy(root);
      await authorize({name:'read', arguments:{file_path:file}});
      const actual = realpathSync(file), text = readFileSync(actual, 'utf8');
      let value;
      try { value = JSON.parse(text); }
      catch { throw Object.assign(Error('文件不是完整JSON；命令JSON请使用stdoutFile，普通文本请省略jsonPointers。'), {code:'FILE_JSON_INVALID'}); }
      const sourceVersion = createHash('sha256').update(text).digest('hex');
      const directory = join(root, 'evidence', 'file-projections');
      await authorize({name:'write', arguments:{file_path:directory}});
      mkdirSync(directory, {recursive:true, mode:0o700});
      const result = project(value, args.jsonPointers, {directory, evidenceId:sourceVersion});
      return {...result, path:actual, sourceVersion, sourceStructure:evidence.outline(value)};
    }
  };
}

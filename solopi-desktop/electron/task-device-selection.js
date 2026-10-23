// Use the same layered component/parameter merge as the workflow runner.
const createComponentMapForCli = (...sets) => {
  const components=new Map();
  for(const list of sets) for(const component of Array.isArray(list)?list:[]) {
    if(!component?.id) continue;
    const base=components.get(component.id);
    const params=new Map((base?.params || []).map(p=>[p.key,p]));
    for(const param of component.params || []) params.set(param.key,param);
    components.set(component.id,{...base,...component,params:[...params.values()]});
  }
  return components;
};
function collectRequiredDeviceRoles(selection) {
  const roles = new Set();
  const hostOnlyStepTypes = new Set(['start', 'end', 'wait', 'if', 'http_request', 'llm_text_generate', 'tts_synthesize']);
  const stateComponents = selection.components || [];

  for (const testCase of Array.isArray(selection?.cases) ? selection.cases : []) {
    const componentMap = createComponentMapForCli(stateComponents, selection.payloadComponents, testCase?.components);
    for (const step of Array.isArray(testCase?.steps) ? testCase.steps : []) {
      const referencedComponent = step.type === 'component' ? componentMap.get(step.componentId) : null;
      for(const value of [step.device,referencedComponent?.device]) if(value && !['phone','glasses','pc'].includes(value))
        throw Object.assign(new Error('用例设备角色仅支持 phone / glasses / pc'),{code:'INVALID_DEVICE_ROLE',caseId:testCase.id,stepId:step.id});
      const params = Object.fromEntries((referencedComponent?.params || []).map(p => [p.key, p.defaultValue]));
      let text = JSON.stringify({ config: step.config, inputs: { ...params, ...step.inputs }, commandTemplate: referencedComponent?.commandTemplate });
      for (let depth = 0; depth < 8; depth++) {
        const next = text.replace(/(?:\$\{|\{\{)variables\.([\w.]+)\}\}?/g, (match, key) => {
          const value = key.split('.').reduce((v, k) => v?.[k], testCase.variables);
          return value == null ? match : String(value);
        });
        if (next === text) break;
        text = next;
      }
      for (const role of ['phone', 'glasses']) {
        if (new RegExp('(?:\\$\\{|\\{\\{)(?:defaults\\.)?' + role + 'Serial\\s*\\}').test(text)) roles.add(role);
      }
      if (hostOnlyStepTypes.has(step?.type)) continue;
      if (step?.type === 'component') {
        const component = componentMap.get(step.componentId);
        if (component?.kind === 'pc_command') continue;
        if (component?.kind === 'audio' && (step.device || component.device) === 'pc') {
          const enabled = step.inputs?.pushEnabled ?? component.params?.find((param) => param.key === 'pushEnabled')?.defaultValue;
          if (enabled === true || enabled === 'true') roles.add((step.inputs?.pushDevice ?? component.params?.find((param) => param.key === 'pushDevice')?.defaultValue) === 'glasses' ? 'glasses' : 'phone');
          continue;
        }
        if (component?.kind === 'image_mock') {
          const pushDevice = String(step.inputs?.pushDevice || params.pushDevice || 'glasses') === 'phone' ? 'phone' : 'glasses';
          const commandDevice = String(step.inputs?.commandDevice || params.commandDevice || 'phone');
          roles.add(pushDevice);
          if (commandDevice !== 'pc') roles.add(commandDevice === 'glasses' ? 'glasses' : 'phone');
          continue;
        }
        if (component?.kind === 'pc_command') continue;
        const device=step.device || component?.device;
        roles.add(device === 'glasses' ? 'glasses' : 'phone');
        continue;
      }
      if (step.type === 'send_audio' && step.device === 'pc') {
        if (step.config?.pushEnabled === true || step.config?.pushEnabled === 'true') roles.add(step.config?.pushDevice === 'glasses' ? 'glasses' : 'phone');
        continue;
      }
      roles.add(step.device === 'glasses' ? 'glasses' : 'phone');
    }
  }

  return roles;
}

function resolveTaskDevices(payload, header = {}, online = []) {
  const result = structuredClone(payload);
  const required = collectRequiredDeviceRoles({...result, payloadComponents:result.components});
  result.devices = {...result.devices};
  for (const role of required) {
    const explicit = result.devices[role];
    const selected = explicit?.serial ? explicit : header[role];
    if (!selected?.serial || !online.some(d => d.serial === selected.serial && d.state === 'device')) {
      throw Object.assign(new Error(`${role} 设备未选择或不在线；请在头部选择设备，或显式指定本次任务 SN。`), {code:'DEVICE_PREFLIGHT_NO_MATCH', role, serial:selected?.serial || ''});
    }
    // Only transport identity comes from the header; keep each case's business package.
    result.devices[role] = {...(selected.runtime ? {runtime:selected.runtime} : {}), ...explicit, serial:selected.serial};
  }
  return result;
}
module.exports = {collectRequiredDeviceRoles, resolveTaskDevices};

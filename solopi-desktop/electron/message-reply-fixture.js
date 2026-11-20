const { FIXTURE_PACKAGE } = require('./message-reply-task');
const CHAT_ENTRY = 'com.solopi.fastpath.demo:id/scenario_chat';
const SIMULATION_BUTTONS = Object.freeze({
  text:'com.solopi.fastpath.demo:id/chat_arrival',
  image:'com.solopi.fastpath.demo:id/chat_picture',
});
const SIMULATION_WAKE = 'com.solopi.fastpath.demo:id/chat_wake';
const CONVERSATION = /^fixture:conversation:([A-Za-z0-9_-]+):(single|group):(unique|ambiguous)$/;
const MESSAGE = /^fixture:message:([A-Za-z0-9_-]+):(incoming|outgoing|system):(text|image|other):(active|retracted)$/;

function fixtureTextIntent(text) {
  const value = text.trim();
  if (!value || /[\r\n\u0000-\u001f\u007f]/.test(value)) return 'uncertain';
  if (/^(?:你好|您好|谢谢|多谢|好的|收到|再见)[。！!]*$/.test(value)) return 'not_question';
  if (/[?？]$/.test(value)) return 'question';
  if (/^(?:请|麻烦|帮我|能否|可以帮我)(?:(?:介绍一下|解释一下|说明一下)(?:[^。！？!?\r\n]{1,200})?|(?:查询|查一下|查查|查)[^。！？!?\r\n]{1,200})[。！!]*$/.test(value))
    return 'question';
  return 'uncertain';
}

function parseFixtureObservation(data, contactId) {
  if (!data || typeof data.observationId !== 'string' || !data.observationId ||
      !Array.isArray(data.nodes) || !Array.isArray(data.readableNodes) || data.actionBlockedReason)
    throw Error('fixture_observation_unavailable');
  const nodes = [...data.nodes, ...data.readableNodes];
  const conversations = nodes.filter(node => typeof node?.description === 'string' && CONVERSATION.test(node.description));
  if (conversations.length !== 1) throw Error('conversation_identity_unconfirmed');
  const identity = conversations[0].description.match(CONVERSATION);
  if (identity[1] !== contactId || identity[2] !== 'single' || identity[3] !== 'unique')
    throw Error('conversation_identity_unconfirmed');
  const counts = nodes.filter(node => typeof node?.description === 'string' &&
    node.description.startsWith('fixture:message-count:'));
  const countMatch = counts.length === 1 && /^fixture:message-count:([1-9][0-9]*):([0-9a-f]{32})$/.exec(counts[0].description);
  if (!countMatch || !Number.isSafeInteger(Number(countMatch[1])) || Number(countMatch[1]) > 10000)
    throw Error('fixture_message_ambiguous');
  const ids = new Set();
  const messages = [];
  for (const node of nodes) {
    if (typeof node?.description !== 'string' || !node.description.startsWith('fixture:message:')) continue;
    const item = node.description.match(MESSAGE);
    if (!item || ids.has(item[1]) || typeof node.text !== 'string' || node.text.length > 4000)
      throw Error('fixture_message_ambiguous');
    ids.add(item[1]);
    // Code security: only the fixed fixture's contiguous message IDs establish order.
    const sequence = item[1] === 'old-1' ? 0 : /^m[1-9][0-9]*$/.test(item[1]) ? Number(item[1].slice(1)) : NaN;
    if (!Number.isSafeInteger(sequence)) throw Error('fixture_message_ambiguous');
    // Code security: this classification is only a fixture routing hint; it never authorizes a conversation or action.
    const textIntent = item[3] === 'text' ? fixtureTextIntent(node.text) : 'uncertain';
    messages.push({ id:item[1], sequence, direction:item[2], kind:item[3], retracted:item[4] === 'retracted',
      text:node.text, unique:true, afterBaseline:true,
      textIntent, isQuestion:textIntent === 'question',
      imageVerified:item[2] === 'incoming' && item[3] === 'image' && item[4] === 'active' &&
        typeof node.id === 'string' && Array.isArray(node.actions) && node.actions.includes('click') });
  }
  messages.sort((a,b) => a.sequence - b.sequence);
  if (messages.length !== Number(countMatch[1]) || messages.some((message,index) => message.sequence !== index))
    throw Error('fixture_message_ambiguous');
  return { contactId, instanceId:countMatch[2], identityVerified:true, complete:true, observationId:data.observationId, messages };
}

function createFixtureSessionFactory({ control, controlConfig, evidenceStore }) {
  async function request(owner, operation, payload, evidenceRunId) {
    const result = await control.request(operation, payload, { owner, ...(evidenceRunId ? {evidenceRunId} : {}) });
    if (!result?.success || !result.data) throw Error('fixture_device_request_failed');
    return result.data;
  }
  function cleanupResult(result) {
    if (result?.success !== true || result.data?.cleanupConfirmed !== true) return {cleanupConfirmed:false};
    return {cleanupConfirmed:true, recoveryRecordPendingAck:result.recoveryRecordPendingAck === true};
  }
  async function recoverSession(owner) {
    const result = control.ownsVirtual(owner)
      ? await control.request('virtual_end', {completed:false}, {owner})
      : await control.recoverVirtual(owner);
    return cleanupResult(result);
  }
  async function openSession({ owner, evidenceRunId, deviceId, contactId, appId }) {
    if (appId !== FIXTURE_PACKAGE || contactId !== 'friend-1') throw Error('fixture_only');
    const setting = controlConfig();
    if (!setting || typeof setting.packageName !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(setting.packageName) ||
        !Number.isInteger(setting.port) || setting.port < 1024 || setting.port > 65535) throw Error('invalid_control_configuration');
    let data = await request(owner, 'virtual_start', { platform:'android', deviceId,
      deviceKind:deviceId.startsWith('emulator-') ? 'simulator' : 'physical', appId:FIXTURE_PACKAGE,
      controlPackage:setting.packageName, controlPort:setting.port, fixedChecks:[] }, evidenceRunId);
    if (evidenceRunId) evidenceStore.bind(owner, evidenceRunId);
    const entries = Array.isArray(data.nodes) ? data.nodes.filter(node => node.resourceId === CHAT_ENTRY &&
      Array.isArray(node.actions) && node.actions.includes('click')) : [];
    if (entries.length !== 1 || typeof data.observationId !== 'string') throw Error('fixture_entry_unavailable');
    data = await request(owner, 'virtual_act', { observationId:data.observationId, targetId:entries[0].id, action:'click' });
    let latest = parseFixtureObservation(data, contactId);
    const instanceId = latest.instanceId;
    let invalid = false;
    // Code security: a reset can reuse message IDs; bind all subsequent observations to the original chat instance.
    const parseBound = value => {
      try {
        const snapshot = parseFixtureObservation(value, contactId);
        if (snapshot.instanceId !== instanceId) throw Error('conversation_identity_unconfirmed');
        return snapshot;
      } catch (error) { invalid = true; throw error; }
    };
    const imageBindings = new Map();
    const checkCancelled = signal => { if (signal?.aborted) throw Error('reply_cancelled'); };
    const incoming = (snapshot, messageId, kind) => snapshot.messages.filter(item => item.id === messageId &&
      item.direction === 'incoming' && item.kind === kind && !item.retracted);
    return {
      notificationStatus:() => request(owner, 'virtual_notification_status', {}),
      observe:async () => {
        data = await request(owner, 'virtual_observe', {});
        latest = parseBound(data);
        return latest;
      },
      simulateArrival:async ({kind = 'text', signal, canProceed = () => true} = {}) => {
        if (invalid) throw Error('conversation_identity_unconfirmed');
        // Code security: only fixed fixture actions are accepted, never caller-selected nodes.
        if (!Object.hasOwn(SIMULATION_BUTTONS, kind)) throw Error('invalid_fixture_simulation');
        for (const resourceId of [SIMULATION_BUTTONS[kind], SIMULATION_WAKE]) {
          checkCancelled(signal);
          if (!canProceed()) throw Error('session_duration_limit');
          data = await request(owner, 'virtual_observe', {});
          checkCancelled(signal);
          if (!canProceed()) throw Error('session_duration_limit');
          latest = parseBound(data);
          // Code security: the renderer cannot choose the target; each action is
          // selected from the current observation of this fixed fixture session.
          const buttons = data.nodes.filter(node => node.resourceId === resourceId &&
            typeof node.id === 'string' && Array.isArray(node.actions) && node.actions.includes('click'));
          if (buttons.length !== 1) throw Error('fixture_simulation_unavailable');
          data = await request(owner, 'virtual_act', {observationId:data.observationId, targetId:buttons[0].id, action:'click'});
          if (data.receipt?.status !== 'succeeded') throw Error('fixture_simulation_unconfirmed');
          checkCancelled(signal);
          latest = parseBound(data);
          imageBindings.clear();
        }
      },
      captureImage:async ({observationId, messageId, signal}) => {
        checkCancelled(signal);
        if (invalid) throw Error('conversation_identity_unconfirmed');
        if (latest.observationId !== observationId || incoming(latest, messageId, 'image').length !== 1 ||
            incoming(latest, messageId, 'image')[0].imageVerified !== true) throw Error('image_unconfirmed');
        const imageNodes = data.nodes.filter(node => node.description === `fixture:message:${messageId}:incoming:image:active` &&
          typeof node.id === 'string' && Array.isArray(node.actions) && node.actions.includes('click'));
        if (imageNodes.length !== 1) throw Error('image_unconfirmed');
        const preview = await request(owner, 'virtual_act', {observationId, targetId:imageNodes[0].id, action:'click'});
        checkCancelled(signal);
        const previewNodes = [...(preview.nodes || []), ...(preview.readableNodes || [])]
          .filter(node => node.description === `fixture:image:${messageId}`);
        if (previewNodes.length !== 1 || typeof preview.observationId !== 'string') throw Error('image_unconfirmed');
        const crop = await request(owner, 'virtual_fixture_crop', {observationId:preview.observationId, messageId});
        checkCancelled(signal);
        if (crop.verified !== true || crop.observationId !== preview.observationId || crop.messageId !== messageId ||
            typeof crop.imageData !== 'string' || crop.imageData.length > 12 * 1024 * 1024 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(crop.imageData))
          throw Error('image_unconfirmed');
        const bytes = Buffer.from(crop.imageData, 'base64');
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw Error('image_unconfirmed');
        const back = (preview.nodes || []).filter(node => node.resourceId === 'com.solopi.fastpath.demo:id/reset_button' &&
          typeof node.id === 'string' && Array.isArray(node.actions) && node.actions.includes('click'));
        if (back.length !== 1) throw Error('image_unconfirmed');
        data = await request(owner, 'virtual_act', {observationId:preview.observationId, targetId:back[0].id, action:'click'});
        checkCancelled(signal);
        latest = parseBound(data);
        if (incoming(latest, messageId, 'image').length !== 1 || !incoming(latest, messageId, 'image')[0].imageVerified)
          throw Error('image_unconfirmed');
        imageBindings.clear();
        imageBindings.set(observationId, {messageId, observationId:latest.observationId});
        return {observationId, messageId, verified:true, bytes};
      },
      send:async ({contactId:claimedContact, messageId, observationId, reply, signal}) => {
        checkCancelled(signal);
        if (invalid) throw Error('conversation_identity_unconfirmed');
        if (claimedContact !== contactId) throw Error('conversation_identity_unconfirmed');
        const binding = imageBindings.get(observationId);
        if (binding && binding.messageId !== messageId) throw Error('image_unconfirmed');
        const boundObservation = binding ? binding.observationId : observationId;
        if (latest.observationId !== boundObservation ||
            !latest.messages.some(item => item.id === messageId && item.direction === 'incoming' && !item.retracted))
          throw Error('fixture_message_unconfirmed');
        const input = await request(owner, 'virtual_fixture_input', {contactId,messageId,observationId:boundObservation,reply});
        if (input.receipt?.status !== 'succeeded') throw Error('fixture_input_unconfirmed');
        const afterInput = parseBound(input);
        if (!afterInput.messages.some(item => item.id === messageId && item.direction === 'incoming' && !item.retracted))
          throw Error('fixture_message_unconfirmed');
        checkCancelled(signal);
        const sent = await request(owner, 'virtual_fixture_send', {contactId,messageId,observationId:afterInput.observationId,reply});
        if (sent.receipt?.status !== 'succeeded') throw Error('fixture_send_unconfirmed');
        const afterSend = parseBound(sent);
        const beforeIds = new Set(afterInput.messages.map(item => item.id));
        const newReplies = afterSend.messages.filter(item => !beforeIds.has(item.id) && item.direction === 'outgoing' &&
          item.kind === 'text' && item.retracted === false && item.text === reply);
        if (newReplies.length !== 1) throw Error('fixture_send_unconfirmed');
        latest = afterSend;
        data = sent;
        imageBindings.clear();
        return {confirmed:true,contactId,messageId,observationId,contentVerified:true,outgoingId:newReplies[0].id};
      },
      close:async () => cleanupResult(await control.request('virtual_end', {completed:false}, {owner})),
    };
  }
  // Code security: remove the retained recovery capability only after the task
  // has durably recorded device cleanup and completed its evidence index.
  const acknowledgeCleanup = owner => control.acknowledgeVirtualCleanup(owner);
  return {openSession,recoverSession,acknowledgeCleanup};
}
module.exports = { createFixtureSessionFactory, parseFixtureObservation };

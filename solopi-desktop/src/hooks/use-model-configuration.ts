import { useRef, useState, type Dispatch, type SetStateAction } from 'react';

export interface LlmProviderConfig {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: 'openai-compatible';
  responseFormat?: 'default' | 'json_object';
  thinking?: 'default' | 'disabled';
  capabilities?: ModelCapabilities;
}
type ModelCapabilities = {
  responseFormat: 'unknown' | 'supported' | 'unsupported';
  thinking: 'unknown' | 'supported' | 'unsupported';
};
const unknownCapabilities = (): ModelCapabilities => ({ responseFormat: 'unknown', thinking: 'unknown' });
export function createLlmProviderDraft(): LlmProviderConfig {
  return {
    id: `llm-provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: 'OpenAI Compatible', baseUrl: '', apiKey: '', model: '',
    protocol: 'openai-compatible', responseFormat: 'default', thinking: 'default',
  };
}

// The settings editor owns a draft, never the conversation's selected model.
export function useModelConfiguration({ providers, setProviders, selectedProviderId, setSelectedProviderId, testProvider }: {
  providers: LlmProviderConfig[];
  setProviders: Dispatch<SetStateAction<LlmProviderConfig[]>>;
  selectedProviderId: string;
  setSelectedProviderId: Dispatch<SetStateAction<string>>;
  testProvider: (provider: LlmProviderConfig) => Promise<{ success?: boolean; error?: string; content?: string; capabilities?: ModelCapabilities } | undefined>;
}) {
  const [llmProviderDraft, setLlmProviderDraft] = useState<LlmProviderConfig>(() => (
    providers.find(provider => provider.id === selectedProviderId) || providers[0] || createLlmProviderDraft()
  ));
  const [llmCapabilityStatus, setLlmCapabilityStatus] = useState<ModelCapabilities>(() => llmProviderDraft.capabilities || unknownCapabilities());
  const [providerTestMessage, setProviderTestMessage] = useState('');
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const draftRef = useRef(llmProviderDraft);
  draftRef.current = llmProviderDraft;
  const selectLlmProvider = (provider: LlmProviderConfig) => {
    setLlmProviderDraft({ ...provider });
    setLlmCapabilityStatus(provider.capabilities || unknownCapabilities());
    setProviderTestMessage('');
  };
  const addLlmProvider = () => selectLlmProvider(createLlmProviderDraft());
  const cancelLlmProviderDraft = () => selectLlmProvider(
    providers.find(provider => provider.id === selectedProviderId) || providers[0] || createLlmProviderDraft(),
  );
  const saveLlmProvider = () => {
    const window = llmProviderDraft.contextWindowTokens;
    const output = llmProviderDraft.maxOutputTokens ?? 16384;
    if ((window !== undefined && (!Number.isSafeInteger(window) || window <= output)) || !Number.isSafeInteger(output) || output <= 0) {
      setProviderTestMessage('上下文容量和输出上限必须为正整数，容量须大于输出上限。');
      return false;
    }
    try {
      if (!llmProviderDraft.model.trim() || !['http:', 'https:'].includes(new URL(llmProviderDraft.baseUrl.trim()).protocol)) throw Error();
    } catch {
      setProviderTestMessage('请填写模型名称和有效的 HTTP(S) Base URL。');
      return false;
    }
    const nextProvider: LlmProviderConfig = {
      ...llmProviderDraft, name: llmProviderDraft.name.trim() || 'OpenAI Compatible',
      baseUrl: llmProviderDraft.baseUrl.trim(), apiKey: llmProviderDraft.apiKey.trim(),
      model: llmProviderDraft.model.trim(), protocol: 'openai-compatible', capabilities: llmCapabilityStatus,
    };
    setProviders(current => current.some(provider => provider.id === nextProvider.id)
      ? current.map(provider => provider.id === nextProvider.id ? nextProvider : provider)
      : [...current, nextProvider]);
    // Establish a default only when none exists, never when browsing/saving another model.
    if (!providers.some(provider => provider.id === selectedProviderId)) setSelectedProviderId((providers[0] || nextProvider).id);
    setLlmProviderDraft(nextProvider);
    setProviderTestMessage('模型配置已保存到本机。');
    return true;
  };
  const removeLlmProvider = (providerId: string) => {
    if (!providers.some(provider => provider.id === providerId)) { cancelLlmProviderDraft(); return; }
    const remaining = providers.filter(provider => provider.id !== providerId);
    setProviders(current => current.filter(provider => provider.id !== providerId));
    if (selectedProviderId === providerId) setSelectedProviderId(remaining[0]?.id || '');
    if (llmProviderDraft.id === providerId) selectLlmProvider(
      remaining.find(provider => provider.id === selectedProviderId) || remaining[0] || createLlmProviderDraft(),
    );
  };
  const testLlmProvider = async () => {
    const testedDraft = draftRef.current;
    setIsTestingProvider(true);
    setProviderTestMessage('正在测试模型连接...');
    try {
      const result = await testProvider(testedDraft);
      if (draftRef.current !== testedDraft) return;
      if (!result?.success) { setProviderTestMessage(result?.error || '模型连接失败'); return; }
      const capabilities = result.capabilities || unknownCapabilities();
      setLlmCapabilityStatus(capabilities);
      const label = (value: string) => value === 'supported' ? '支持' : value === 'unsupported' ? '不支持' : '未知';
      setProviderTestMessage(`连接成功：${result.content || 'OK'}。JSON Output：${label(capabilities.responseFormat)}；Thinking：${label(capabilities.thinking)}。点击「保存配置」后保存。`);
    } catch (error) {
      if (draftRef.current === testedDraft) setProviderTestMessage(error instanceof Error ? error.message : '模型连接失败');
    } finally { setIsTestingProvider(false); }
  };
  return {
    llmProviderDraft, setLlmProviderDraft, llmCapabilityStatus, setLlmCapabilityStatus,
    providerTestMessage, setProviderTestMessage, isTestingProvider,
    isNewLlmProvider: !providers.some(provider => provider.id === llmProviderDraft.id),
    selectLlmProvider, addLlmProvider, cancelLlmProviderDraft, saveLlmProvider, removeLlmProvider, testLlmProvider,
  };
}

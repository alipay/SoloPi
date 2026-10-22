import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Play, Brain, Wrench, GitBranch, Square, Smartphone, Eye, Camera, Terminal, Clock, CheckCircle2, XCircle, Trash2, Copy, Check, Image as ImageIcon, Volume2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const nodeIcons: Record<string, React.ReactNode> = {
  start: <Play className="w-4 h-4 text-white" />,
  llm: <Brain className="w-4 h-4 text-white" />,
  tool: <Wrench className="w-4 h-4 text-white" />,
  condition: <GitBranch className="w-4 h-4 text-white" />,
  end: <Square className="w-4 h-4 text-white" />,
  adb: <Terminal className="w-4 h-4 text-white" />,
  mobile: <Smartphone className="w-4 h-4 text-white" />,
  pay: <Smartphone className="w-4 h-4 text-white" />,
  audio: <Camera className="w-4 h-4 text-white" />,
  image: <ImageIcon className="w-4 h-4 text-white" />,
  capture: <Eye className="w-4 h-4 text-white" />,
};

const nodeColors: Record<string, string> = {
  start: 'bg-node-start',
  llm: 'bg-node-llm',
  tool: 'bg-node-tool',
  condition: 'bg-node-condition',
  end: 'bg-node-end',
  adb: 'bg-blue-600',
  mobile: 'bg-sky-600',
  pay: 'bg-emerald-600',
  audio: 'bg-indigo-600',
  image: 'bg-cyan-600',
  capture: 'bg-amber-600',
};

const statusConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pending: {
    label: '等待',
    className: 'bg-slate-100 text-slate-500',
    icon: <Clock className="w-3 h-3" />,
  },
  running: {
    label: '执行中',
    className: 'bg-blue-50 text-blue-600',
    icon: <Clock className="w-3 h-3 animate-pulse" />,
  },
  success: {
    label: '成功',
    className: 'bg-emerald-50 text-emerald-600',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  failed: {
    label: '失败',
    className: 'bg-rose-50 text-rose-600',
    icon: <XCircle className="w-3 h-3" />,
  },
  stopped: {
    label: '已停止',
    className: 'bg-slate-800 text-white',
    icon: <Square className="w-3 h-3" />,
  },
};

const WorkflowNode = ({ data, type, isConnectable }: any) => {
  const icon = nodeIcons[data.iconType] || nodeIcons[type] || <Play className="w-4 h-4" />;
  const bgColor = nodeColors[data.iconType] || nodeColors[type] || 'bg-blue-500';
  const status = data.status ? statusConfig[data.status] : null;
  const [copiedKey, setCopiedKey] = useState('');

  const copyText = async (key: string, value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1200);
    } catch {
      setCopiedKey('');
    }
  };

  return (
    <div className="bg-card border border-border/50 rounded-xl shadow-xl min-w-[260px] max-w-[340px] overflow-visible cursor-grab active:cursor-grabbing">
      <div className="flex items-center gap-3 p-3 bg-muted/30">
        <div className={cn("p-1.5 rounded-lg shadow-inner", bgColor)}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-bold text-foreground tracking-tight">{data.label}</h3>
          {data.stepTypeLabel && (
            <p className="text-[10px] font-semibold text-muted-foreground truncate">{data.stepTypeLabel}</p>
          )}
          {data.previewLine && (
            <p className="mt-0.5 line-clamp-2 text-[10px] font-semibold leading-3 text-slate-500">{data.previewLine}</p>
          )}
        </div>
        {status && (
          <div className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold', status.className)}>
            {status.icon}
            {status.label}
          </div>
        )}
        {data.onDelete && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete();
            }}
            className="nodrag shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
            title="删除节点"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      
      <div className="p-3 space-y-2 bg-card">
        {data.config && Object.entries(data.config).map(([key, value]: [string, any]) => {
          const isAdbPreview = key === 'ADB' || key === 'ADB命令预览' || key === 'adb命令预览';
          const displayLabel = isAdbPreview ? 'adb命令预览' : key;
          const displayValue = String(value);

          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">{displayLabel}</span>
                {isAdbPreview && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      copyText(key, displayValue);
                    }}
                    className="nodrag rounded-md p-1 text-blue-600 transition-colors hover:bg-blue-50"
                    title="复制 adb 命令"
                  >
                    {copiedKey === key ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                )}
              </div>
              {isAdbPreview ? (
                <textarea
                  readOnly
                  wrap="off"
                  value={displayValue}
                  onMouseDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onWheel={(event) => event.stopPropagation()}
                  className="nodrag nopan nowheel h-20 w-full max-w-full resize-none overflow-auto rounded border border-border/20 bg-secondary/50 px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground/80 outline-none"
                  title="可横向滚动查看完整 adb 命令"
                />
              ) : (
                <div className={`overflow-auto whitespace-pre-wrap break-words rounded border border-border/20 bg-secondary/50 px-2 py-1.5 text-[11px] text-foreground/80 ${
                  key === 'Prompt' || key === '模型' || key === 'model' ? 'max-h-32' : 'max-h-20'
                }`}>
                  {displayValue}
                </div>
              )}
            </div>
          );
        })}
        {data.required && (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/10">
            <span>× {data.requiredLabel || 'count'}</span>
            <span className="text-destructive font-medium">必填</span>
          </div>
        )}
        {data.resultPreview && (
          <div className="border-t border-border/10 pt-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">结果预览</span>
              {data.resultPreview.statusLabel && (
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                  data.resultPreview.kind === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
                )}>
                  {data.resultPreview.statusLabel}
                </span>
              )}
            </div>
            {data.resultPreview.kind === 'audio' ? (
              <div className="rounded border border-indigo-100 bg-indigo-50/60 px-2 py-2">
                <div className="mb-1 line-clamp-2 break-all font-mono text-[10px] font-semibold leading-3 text-indigo-900">
                  {data.resultPreview.title || data.resultPreview.path || '音频文件'}
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (data.resultPreview.onPlay) {
                      data.resultPreview.onPlay();
                      return;
                    }
                    if (data.resultPreview.stepId) {
                      window.dispatchEvent(new CustomEvent('glassbox:workflow-node-play-audio', {
                        detail: { stepId: data.resultPreview.stepId },
                      }));
                    }
                  }}
                  disabled={!data.resultPreview.canPlay}
                  className="nodrag inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[10px] font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="播放音频"
                >
                  <Volume2 className="h-3 w-3" />
                  播放音频
                </button>
              </div>
            ) : (
              <textarea
                readOnly
                value={data.resultPreview.text || ''}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
                className={cn(
                  'nodrag nopan nowheel h-20 w-full resize-none overflow-auto rounded border px-2 py-1.5 text-[11px] leading-4 outline-none',
                  data.resultPreview.kind === 'error'
                    ? 'border-rose-100 bg-rose-50 text-rose-900'
                    : 'border-blue-100 bg-blue-50/70 font-mono text-blue-950'
                )}
              />
            )}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="!h-3.5 !w-3.5 !bg-white !border-2 !border-blue-500 !shadow-md"
      />
      {type !== 'condition' && (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={isConnectable}
          className="!h-3.5 !w-3.5 !bg-white !border-2 !border-blue-500 !shadow-md"
        />
      )}

      {type === 'condition' && (
        <>
          <div className="absolute right-1 top-[27%] text-[10px] font-bold text-emerald-600">true</div>
          <div className="absolute right-1 top-[47%] text-[10px] font-bold text-amber-600">false</div>
          <div className="absolute right-1 top-[67%] text-[10px] font-bold text-rose-600">error</div>
          {[
            { id: 'true', top: '30%', color: '!border-emerald-500' },
            { id: 'false', top: '50%', color: '!border-amber-500' },
            { id: 'error', top: '70%', color: '!border-rose-500' },
          ].map((handle) => (
            <Handle
              key={handle.id}
              type="source"
              position={Position.Right}
              id={handle.id}
              isConnectable={isConnectable}
              className={`!h-3.5 !w-3.5 !bg-white !border-2 !shadow-md ${handle.color}`}
              style={{ top: handle.top }}
            />
          ))}
        </>
      )}
    </div>
  );
};

export default memo(WorkflowNode);

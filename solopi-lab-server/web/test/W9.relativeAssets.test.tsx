/**
 * W9 白屏回归（用户8790经CloudIDE代理前缀访问空白）：
 * index.html 资产必须为相对路径引用（./assets/...），使IDE代理/子路径托管下
 * 浏览器能正确解析到带前缀的资产URL；禁止回退为根路径绝对引用。
 * 未授权（无连接）时页面也必须可渲染：App冒烟断言不再依赖任何网络成功。
 */
import { readFileSync } from 'fs';
import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';

afterEach(() => cleanup());

describe('W9 构建资产相对引用（防代理前缀白屏）', () => {
  it('dist/index.html 的 JS/CSS 均为 ./assets/ 相对引用', () => {
    // vitest运行cwd=web根；直接按相对路径读构建产物
    const html = readFileSync('dist/index.html', 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => r.includes('assets/'));
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs) {
      expect(ref.startsWith('./assets/')).toBe(true); // 相对引用：任意路径前缀下可解析
      expect(ref.startsWith('/assets/')).toBe(false); // 禁止根路径绝对引用（代理前缀下404白屏）
    }
  });

  it('无连接时App也必须渲染（未授权不能白屏）——冒烟断言', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response));
    location.hash='#/overview';
    render(<App />);
    expect(document.querySelector('[data-testid="unconnected-notice"]')).not.toBeNull();
    expect(document.querySelector('nav a')).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('W10 可观测性占位（JS被阻不再白屏）', () => {
  it('构建产物#root内置非空白占位：JS失败时用户看到说明而非纯白屏', () => {
    const html = readFileSync('dist/index.html', 'utf8');
    expect(html.includes('id="boot-placeholder"')).toBe(true);
    expect(html.includes('未成功加载或执行')).toBe(true);
    // 占位文案不得包含任何地址/凭据/前端不该知道的内部路径
    expect(html.includes('token')).toBe(false);
  });

  it('App渲染后#root内容正常出现未连接界面（占位可被React替换的常规冒烟）', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response));
    location.hash='#/overview';
    render(<App />);
    expect(document.querySelector('[data-testid="unconnected-notice"]')).not.toBeNull();
    expect(document.querySelector('nav a')).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

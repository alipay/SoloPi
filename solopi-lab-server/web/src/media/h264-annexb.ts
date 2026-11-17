/**
 * Annex-B H264 辅助解析（纯函数，浏览器侧）。
 *
 * 服务端 r5.1 合同（device-media-contract.md §2 B6）：数据面 client→viewer 单向
 * 二进制原码透传，messageBoundary = annex-b access unit（一条 WS binary message = 一个
 * 完整 access unit），首个 access unit 必须 IDR 且前置 SPS/PPS；Server 零 NAL 解析。
 *
 * 解码输入要求（Desktop 采集侧联调基线）：
 * 1. 每条 WS binary message 必须是一个完整 Annex-B access unit（不得发碎 chunk / 半个 AU）；
 * 2. 首条 message 必须是 IDR 关键帧，且 forward SPS/PPS 于其前（IDR 间隔即恢复点，GOP≤2s）；
 * 3. 时间戳（C41 合同核对后对齐）：当前 WS 原码消息不含 scrcpy 12 字节头（原 PTS 来源），Annex-B
 *    流内不保证可解复用 PTS——本网页以**解码顺序合成时钟**作监视呈现时间轴，这只电视面时间且
 *    **不是原 PTS 透传**；原 PTS 语义由合同单负责人裁定（端侧适配层可取得原 PTS），不由本页代定。
 */

/** 从 access unit 拆出逐个 NAL 的载荷（不含起始码），按出现顺序返回 */
export function annexbSplitNals(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  let i = 0;
  const n = data.length;
  while (i + 3 <= n) {
    // 起始码：00 00 01 或 00 00 00 01（前导零容忍至4字节）
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      const start = i + 3;
      let end = -1;
      let j = start;
      while (j + 3 <= n) {
        if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && j + 3 < n && data[j + 3] === 1))) {
          end = j;
          break;
        }
        j++;
      }
      if (end === -1) end = n;
      nals.push(data.subarray(start, end));
      i = end;
    } else {
      i++;
    }
  }
  return nals;
}

/** NAL 类型（annexb 头首字节 & 0x1f）；非 VCL/参数集返回 null */
export function nalType(payload: Uint8Array): number | null {
  if (payload.length < 1) return null;
  return payload[0] & 0x1f;
}

/**
 * 从 SPS 载荷推导 WebCodecs avc1 编码串：avc1.<profile_idc两字hex><constraint_flags两字hex><level_idc两字hex>。
 * 例：SPS 字节 0x42 0x00 0x1f → `avc1.42001f`。
 * 不做完整 SPS 语法解析——WebCodecs annexb 配置不需要 description/codedWidth。
 */
export function spsToAvc1Codec(sps: Uint8Array): string | null {
  // sps 载荷首字节为NAL头(0x67)，随后 profile_idc / constraint_flags / level_idc
  if (sps.length < 4) return null;
  const profile = sps[1];
  const constraint = sps[2];
  const level = sps[3];
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  return `avc1.${hex(profile)}${hex(constraint)}${hex(level)}`;
}

/** AU 中是否含 IDR NAL（type 5；profile 特例 7/10 等比例 SPS 路径不区分，IDR均=5） */
export function auHasKeyframe(au: Uint8Array): boolean {
  for (const nal of annexbSplitNals(au)) {
    if (nalType(nal) === 5) return true;
  }
  return false;
}

/** 从 AU 中找到 SPS（type 7）/PPS（type 8）载荷 */
export function annexbFindNal(au: Uint8Array, type: number): Uint8Array | null {
  for (const nal of annexbSplitNals(au)) {
    if (nalType(nal) === type) return nal;
  }
  return null;
}

/**
 * viewer WSS 地址构造——仅同源（location.host）+ 固定路径前缀 /ws/media/ + 服务端发出的
 * 一次性 viewer 票 token。不做任何跨源/自定义 URL 信任：pathTemplate 只接受
 * `/ws/media/{ticket}` 合同字面量，token 必须满足服务端票据字符集（32+ 位 base64 族），
 * 拒绝拼接出任意 host/path 的可能。
 */
export function viewerWsUrl(pathTemplate: string, ticketToken: string): string | null {
  if (pathTemplate !== '/ws/media/{ticket}') return null;
  if (!/^[A-Za-z0-9._-]{32,}$/.test(ticketToken)) return null;
  if (typeof location === 'undefined') return null;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/media/${ticketToken}`;
}

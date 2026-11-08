// lib-profile.mjs —— profile 自动探测（供 examples/*.mjs 共用）
//
// profile 名在不同机器 / 不同 IDE 版本上不一样（本包历史上见过
// InoProShop(V1.9.0.1) 和 InoProShop(V1.10.0.3) 两种），所以一律不要写死：
// 优先环境变量 INOPROSHOP_PROFILE，否则从 exe 路径推出 Profiles 目录实测挑选。
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 从 exe 路径推出 <install>/CODESYS/Profiles 并列出可用 profile；失败返回 null。 */
export function autoDetectProfile(exe) {
  const profilesDir = path.join(path.dirname(path.dirname(exe)), 'Profiles');
  let names;
  try {
    names = fs
      .readdirSync(profilesDir)
      .filter((f) => f.toLowerCase().endsWith('.profile'))
      .map((f) => f.replace(/\.profile$/i, ''));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  return names.find((n) => n.toLowerCase().startsWith('inoproshop')) || names[0];
}

/** 环境变量优先，其次自动探测；两者都失败时打印判据并退出。 */
export function resolveProfile(exe) {
  const fromEnv = process.env.INOPROSHOP_PROFILE;
  if (fromEnv) return fromEnv;
  const detected = autoDetectProfile(exe);
  if (detected) return detected;
  const profilesDir = path.join(path.dirname(path.dirname(exe)), 'Profiles');
  console.error(`无法确定 profile：未设置 INOPROSHOP_PROFILE，且 ${profilesDir} 下没有 *.profile。`);
  console.error('先确认 InoProShop 安装路径，再设置 INOPROSHOP_EXE / INOPROSHOP_PROFILE。');
  process.exit(2);
}

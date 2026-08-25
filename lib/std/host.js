/**
 * dsh-std Community v0.15 宿主 facet 入口（dsh-plugin.json → facets.host.entry）。
 * 占位实现：/fresh 的功能全部由原生 cordis 入口（lib/index.js + cordis.patch.yml）
 * 提供；std 侧尚无 session/workspace 生命周期协议可承载本插件能力，故不发布任何
 * 协议实现或扩展声明，仅使清单能通过 adapter-dsh 的发现与装载校验。
 */
export default {
  async activate() {},
};

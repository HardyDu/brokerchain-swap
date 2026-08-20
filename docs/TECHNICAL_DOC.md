# BrokerSwap 技术文档

## 范围与状态

本仓库是 BrokerChain 上的 BrokerSwap 合约、部署/验证脚本与只读报价缓存服务。它包含本地 Android 测试工程，但不包含生产 Android 应用的全部源码。`deployments/` 中的地址是脚本输出或模板；使用前必须针对目标链重新验证，`brokerchain-1051.json` 中的 `PLACEHOLDER` 不是部署记录。

## 架构

```
钱包/客户端 ── HTTPS ──> Nginx ──> quote-cache (只读) ──> 本地 JSON-RPC
                                      │
                                      └── Pair.getReserves / totalSupply

客户端签名交易 ───────────────────────────────────────────> AMM 合约
```

- `contracts/broker-swap-core/`：Uniswap V2 Core（Factory、Pair、LP token）。使用 Solidity 0.5.16。
- `contracts/broker-swap-periphery/`：Router、Mini Router 与 Liquidity Router。使用 Solidity 0.6.6；将 ETH/WETH 语义改为 BKC/WBKC，并通过 `factory.getPair()` 查找 Pair。
- `contracts/mock/`：`MockWBKC` 和 `MockUSDT`，仅用于开发/测试场景。
- `scripts/`：部署、验证、诊断、流动性与报价缓存入口。
- `deploy/`：systemd、Nginx 与环境变量示例；`deployments/`：链上地址记录/模板。
- `test/`：Hardhat 合约测试与报价缓存服务测试。

## 本地开发

要求 Node.js（依赖由 `package-lock.json` 锁定）及可访问的兼容 JSON-RPC 节点。安装并执行：

```powershell
npm ci
npm run compile
npm test
npm run test:quote-cache
```

`npm run test` 运行 Hardhat 测试；`test:quote-cache` 单独运行 Node 服务测试。生成的 `artifacts/`、`cache/` 与 `node_modules/` 不应提交。

## 部署与运行

普通预检脚本默认只打印交易资料；传入 `--send` 才会提交交易，例如 `npm run deploy:mini:v2 -- --send`。部署脚本依赖预编译 artifacts，因此先运行 `npm run compile`。`RPC_URL`、`DEPLOYER` 与 `GAS_LIMIT`（适用脚本见 `scripts/`）可从环境覆盖；目标链、账户、余额和固定合约地址必须由操作者核验。

`scripts/deploy-android-local.js` 面向本地链 ID 1051，必须在当前 shell 设置 `DEPLOYER_PRIVATE_KEY`。脚本会拒绝与其固定 `DEPLOYER_ADDR` 不匹配的密钥；不要把密钥、`.env` 或终端输出提交。若密钥曾进入工作区、日志或历史，应立即撤销/轮换。

报价缓存以 `npm run serve:quote-cache` 启动。复制并按实际环境填写 `deploy/quote-cache.env.example`，然后配合 `deploy/quote-cache.service` 与 `deploy/swap-api.broker-chain.com.nginx.conf` 部署。它只读取 Pair 状态，不持有密钥、不签名也不广播交易；RPC 必须为 `eth_call` 返回非空结果，否则服务应保持未就绪而非暴露陈旧报价。详见 [报价缓存服务](QUOTE_CACHE_SERVICE.md)。

## 安全与生产注意事项

- 本仓库未声明审计完成；合约与配置在生产使用前应独立审计并在目标链复核字节码、地址和参数。
- 不公开节点 RPC 端口。报价缓存应监听回环地址，Nginx 仅公开所需的只读端点。
- 地址、默认 RPC 和初始流动性数值是环境相关数据，不是跨网络的可信配置。
- 提交 PR 时仅纳入源代码、测试、`deploy/` 示例、`deployments/` 中可公开的记录及文档。排除 `node_modules/`、Hardhat 输出、APK/keystore、`.env*`、录像/截图、诊断输出、下载工具和大型归档文件；提交前检查暂存区是否含密钥或个人数据。

## 相关文档

- [合约说明](../contracts/README.md)
- [报价缓存服务](QUOTE_CACHE_SERVICE.md)
- [流动性提供](LIQUIDITY_PROVISION.md)
- [功能说明（中文）](FUNCTIONAL_GUIDE.md)

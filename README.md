# BrokerSwap

BrokerSwap 是用于 BrokerChain AMM 兑换的 Solidity 合约、Hardhat 测试、部署/验证脚本和只读报价缓存服务。

## 快速开始

```powershell
npm ci
npm run compile
npm test
npm run test:quote-cache
```

部署和运行说明见 [技术文档](docs/TECHNICAL_DOC.md)。合约结构和版本见 [contracts/README.md](contracts/README.md)。

## 提交范围

建议 PR 只包含 `contracts/`、`scripts/`、`test/`、`deploy/`、可公开的 `deployments/`、`docs/`、`package*.json`、Hardhat 配置和必要的 Android 本地测试源码。不要纳入构建输出、依赖目录、APK/keystore、`.env*`、日志、录屏/截图、诊断文件、下载工具或大型归档文件。

## 安全提示

不要提交私钥或 RPC 凭据。特别是 `scripts/deploy-android-local.js` 只从当前 shell 的 `DEPLOYER_PRIVATE_KEY` 读取部署密钥，并验证其匹配固定的部署者地址。任何已泄露到工作区、日志或 Git 历史的密钥都应立即撤销/轮换。

本项目未声明经过生产安全审计；在真实资产或公开网络使用前，必须独立审计并复核目标链上的地址、字节码和部署参数。

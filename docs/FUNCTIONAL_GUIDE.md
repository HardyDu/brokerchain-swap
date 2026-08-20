# BrokerSwap 功能说明文档

## 概述

BrokerSwap 是 BrokerWallet 钱包中基于 Uniswap V2 协议的 AMM（自动做市商）代币兑换功能。在原有 BKC ↔ wBKC 包装/解包基础上，新增了 BrokerChain 上任意 ERC-20 代币之间的去中心化兑换。

**当前支持路径：**

| 支付方 | 接收方 | 路径类型 |
|--------|--------|---------|
| BKC | wBKC | 包装 (Wrap) |
| wBKC | BKC | 解包 (Unwrap) |
| BKC | mUSDT | AMM swap (payable) |
| mUSDT | BKC | AMM swap (需授权) |
| wBKC | mUSDT | AMM swap (token↔token) |
| mUSDT | wBKC | AMM swap (需授权) |

---

## 界面说明

### 主交互区

- **You pay** 卡片：输入支付金额，选择支付代币。点击代币图标可在 BKC、wBKC、mUSDT 之间切换。
- **⇅ 交换方向按钮**：一键调转支付方和接收方。
- **You receive** 卡片：显示预估收到金额（自动报价），只读。
- **MAX 按钮**：一键填入当前支付代币的全部余额。

### AMM 详情面板（仅在 AMM 兑换时显示）

当所选代币组合不是简单的 wrap/unwrap 时，确认按钮上方会展开以下信息：

| 元素 | 说明 |
|------|------|
| **Rate** | 当前汇率，如 `1 BKC = ~99.4 mUSDT`，根据链上池子储备量实时计算 |
| **Slippage** | 滑点容忍度选择器：0.5%、1%、2%、5%。默认 0.5%。滑点越大，交易越容易成功，但可能得到更少的输出 |
| **Price impact** | 价格影响百分比。低于 2% 正常；≥2% 黄色警告；≥5% 橙色需二次确认；≥10% 阻止交易 |
| **Min received** | 最小保证收到量 = 预估输出 × (1 - 滑点%)。如果实际执行时收到的代币少于此值，交易会回滚 |

### 授权流程（Approve）

当支付的代币是 ERC-20（mUSDT 或 wBKC → mUSDT 路径），首次交易前需要授权 Router 合约代扣权限：

1. 输入金额后，确认按钮变为 **"Approve mUSDT"**（或 "Approve wBKC"）
2. 点击后会发起一笔 approve 交易，授权金额**等于本次输入金额**（精确授权，非无限授权）
3. 授权成功后按钮变为 **Swap**，再次点击执行兑换

如果下次交易金额不超过已授权额度，可跳过 approve 直接 swap。

### 确认对话框

点击 Swap 后弹出确认框，展示完整交易信息：

```
Pay: 1.00 BKC
Receive: ~99.40 mUSDT (min: 98.91 mUSDT)
Rate: 1 BKC = ~99.40 mUSDT
Slippage: 0.5%
Price impact: 0.08%
Router: 0x...
```

确认后交易提交到链上。Wrap/unwrap 路径使用简化的确认信息。

---

## 交易流程

### BKC → mUSDT 流程

1. 选择支付 BKC，接收 mUSDT
2. 输入金额 → 自动获取链上报价
3. 调整滑点（可选，默认 0.5%）
4. 点击 Swap → 确认
5. 链上执行：BKC 自动 wrap 成 wBKC → wBKC 通过池子兑换成 mUSDT → mUSDT 发送到钱包
6. 等待链上确认（约数秒至 2 分钟）
7. 成功后刷新余额，记录交易历史

### mUSDT → BKC 流程

1. 选择支付 mUSDT，接收 BKC
2. 输入金额 → 自动获取报价
3. 首次：点击 "Approve mUSDT" → 等待授权确认
4. 点击 Swap → 确认
5. 链上执行：mUSDT 通过池子兑换成 wBKC → Router 自动 unwrap wBKC → BKC 发送到钱包
6. 成功后刷新余额

---

## 交易历史

在代币详情页可查看交易历史：

- **Swap 记录**（AMM）：展示 `1.00 BKC → 99.40 mUSDT`，两条金额不同
- **Wrap/Unwrap 记录**（旧记录兼容）：展示 `10.00 BKC → 10.00 wBKC`
- 点击记录可查看详情：类型、金额、时间、交易哈希（可复制）、Router 地址、滑点、价格影响

---

## 安全特性

| 特性 | 说明 |
|------|------|
| **滑点保护** | 每笔 swap 都传 `amountOutMin`，若链上执行结果低于最小收到量，交易自动回滚 |
| **截止时间** | 默认 10 分钟，超时未被打包的交易不再执行 |
| **价格影响警告** | ≥2% 警告，≥5% 二次确认，≥10% 阻止交易 |
| **精确授权** | approve 额度 = 本次交易金额，非无限授权，降低合约风险 |
| **白名单** | MVP 阶段仅允许 wBKC/mUSDT 池子，避免用户误入恶意代币池 |
| **密钥加密存储** | 新私钥写入 Android EncryptedSharedPreferences（AES-256 加密），旧明文密钥读取后自动迁移 |

---

## 限制与注意事项

- **MVP 白名单**：当前仅支持 wBKC 和 mUSDT 之间的兑换，暂不支持任意代币
- **池子流动性**：推荐演示池为 1,000 wBKC + 100,000 mUSDT（假设 1 BKC = 100 mUSDT）。单笔交易金额建议不超过输入侧储备的 0.5-1%
- **报价时效**：报价每 800ms 自动刷新，读取链上真实 Pair reserves 计算汇率与价格影响。若链读失败则 priced impact 显示为 0%
- **Gas 费**：AMM swap 消耗的 gas 高于简单 transfer，约为 150,000-300,000 gas
- **网络确认**：交易提交后约 2 秒-2 分钟确认，取决于 BrokerChain 出块速度

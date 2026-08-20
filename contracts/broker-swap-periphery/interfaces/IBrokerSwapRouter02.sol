// SPDX-License-Identifier: GPL-3.0-or-later
// Forked from Uniswap V2 Periphery (https://github.com/Uniswap/v2-periphery)
// Renamed: ETH → BKC naming convention.

pragma solidity >=0.6.2;

import './IBrokerSwapRouter01.sol';

interface IBrokerSwapRouter02 is IBrokerSwapRouter01 {
    function removeLiquidityBKCSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline
    ) external returns (uint amountBKC);
    function removeLiquidityBKCWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external returns (uint amountBKC);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
    function swapExactBKCForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable;
    function swapExactTokensForBKCSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
}

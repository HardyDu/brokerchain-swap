// SPDX-License-Identifier: GPL-3.0-or-later
// Forked from Uniswap V2 Core (https://github.com/Uniswap/v2-core)
// Kept identical to preserve INIT_CODE_PAIR_HASH compatibility.

pragma solidity >=0.5.0;

interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external;
}

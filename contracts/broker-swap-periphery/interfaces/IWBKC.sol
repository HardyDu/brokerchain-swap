// SPDX-License-Identifier: GPL-3.0-or-later
// Forked from Uniswap V2 Periphery (https://github.com/Uniswap/v2-periphery)
// Renamed: WETH → WBKC for BrokerChain native wrapped coin.

pragma solidity >=0.5.0;

interface IWBKC {
    function deposit() external payable;
    function transfer(address to, uint value) external returns (bool);
    function withdraw(uint) external;
}

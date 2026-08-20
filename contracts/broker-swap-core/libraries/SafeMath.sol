// SPDX-License-Identifier: GPL-3.0-or-later
// Forked from Uniswap V2 Core (https://github.com/Uniswap/v2-core)
// Kept identical to preserve INIT_CODE_PAIR_HASH compatibility.

pragma solidity =0.5.16;

library SafeMath {
    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x, 'ds-math-add-overflow');
    }

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x, 'ds-math-sub-underflow');
    }

    function mul(uint x, uint y) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x, 'ds-math-mul-overflow');
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Forked from Uniswap V2 Core (https://github.com/Uniswap/v2-core)
// Kept identical to preserve INIT_CODE_PAIR_HASH compatibility.

pragma solidity =0.5.16;

library UQ112x112 {
    uint224 constant Q112 = 2**112;

    function encode(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * Q112;
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }
}

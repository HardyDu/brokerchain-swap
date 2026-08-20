// SPDX-License-Identifier: GPL-3.0-or-later
// Fixed-pair liquidity router for the existing BrokerSwap mUSDT/WBKC Pair.
pragma solidity =0.6.6;

import './interfaces/IWBKC.sol';
import './libraries/SafeMath.sol';
import './libraries/TransferHelper.sol';

interface ILiquidityFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface ILiquidityPair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function totalSupply() external view returns (uint);
    function transferFrom(address from, address to, uint value) external returns (bool);
    function mint(address to) external returns (uint liquidity);
    function burn(address to) external returns (uint amount0, uint amount1);
}

/**
 * Adds/removes native BKC + mUSDT liquidity atomically while keeping the
 * deployed swap router unchanged. The Pair's ERC-20 LP token is the user's
 * on-chain proof of pool ownership. Swap fees stay in the Pair and therefore
 * increase the assets redeemable by each LP token.
 */
contract BrokerLiquidityRouter {
    using SafeMath for uint;

    address public immutable factory;
    address public immutable WBKC;
    address public immutable musdt;
    address public immutable pair;

    modifier ensure(uint deadline) {
        require(deadline >= _timestampSeconds(), 'BrokerLiquidityRouter: EXPIRED');
        _;
    }

    constructor(address _factory, address _WBKC, address _musdt) public {
        require(_factory != address(0) && _WBKC != address(0) && _musdt != address(0), 'BrokerLiquidityRouter: ZERO_ADDRESS');
        require(_WBKC != _musdt, 'BrokerLiquidityRouter: IDENTICAL_ADDRESSES');
        address _pair = ILiquidityFactory(_factory).getPair(_WBKC, _musdt);
        require(_pair != address(0), 'BrokerLiquidityRouter: NO_PAIR');
        factory = _factory;
        WBKC = _WBKC;
        musdt = _musdt;
        pair = _pair;
    }

    receive() external payable {
        require(msg.sender == WBKC, 'BrokerLiquidityRouter: BKC_REJECTED');
    }

    function getReserves() public view returns (uint reserveMusdt, uint reserveWbkc) {
        (uint112 reserve0, uint112 reserve1,) = ILiquidityPair(pair).getReserves();
        return musdt < WBKC ? (uint(reserve0), uint(reserve1)) : (uint(reserve1), uint(reserve0));
    }

    function quoteAddLiquidity(uint amountMusdtDesired, uint amountBkcDesired)
        public view returns (uint amountMusdt, uint amountBkc, uint estimatedLiquidity)
    {
        require(amountMusdtDesired > 0 && amountBkcDesired > 0, 'BrokerLiquidityRouter: INSUFFICIENT_AMOUNT');
        (uint reserveMusdt, uint reserveWbkc) = getReserves();
        require(reserveMusdt > 0 && reserveWbkc > 0, 'BrokerLiquidityRouter: INSUFFICIENT_LIQUIDITY');
        uint amountBkcOptimal = amountMusdtDesired.mul(reserveWbkc) / reserveMusdt;
        if (amountBkcOptimal <= amountBkcDesired) {
            (amountMusdt, amountBkc) = (amountMusdtDesired, amountBkcOptimal);
        } else {
            uint amountMusdtOptimal = amountBkcDesired.mul(reserveMusdt) / reserveWbkc;
            (amountMusdt, amountBkc) = (amountMusdtOptimal, amountBkcDesired);
        }
        uint supply = ILiquidityPair(pair).totalSupply();
        uint liquidityFromMusdt = amountMusdt.mul(supply) / reserveMusdt;
        uint liquidityFromBkc = amountBkc.mul(supply) / reserveWbkc;
        estimatedLiquidity = liquidityFromMusdt < liquidityFromBkc ? liquidityFromMusdt : liquidityFromBkc;
    }

    function quoteRemoveLiquidity(uint liquidity)
        external view returns (uint amountMusdt, uint amountBkc)
    {
        require(liquidity > 0, 'BrokerLiquidityRouter: INSUFFICIENT_LIQUIDITY');
        (uint reserveMusdt, uint reserveWbkc) = getReserves();
        uint supply = ILiquidityPair(pair).totalSupply();
        require(supply > 0, 'BrokerLiquidityRouter: ZERO_SUPPLY');
        amountMusdt = liquidity.mul(reserveMusdt) / supply;
        amountBkc = liquidity.mul(reserveWbkc) / supply;
    }

    function addLiquidityBKC(
        uint amountMusdtDesired,
        uint amountMusdtMin,
        uint amountBkcMin,
        uint liquidityMin,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint amountMusdt, uint amountBkc, uint liquidity) {
        require(to != address(0), 'BrokerLiquidityRouter: ZERO_RECIPIENT');
        (amountMusdt, amountBkc,) = quoteAddLiquidity(amountMusdtDesired, msg.value);
        require(amountMusdt >= amountMusdtMin, 'BrokerLiquidityRouter: INSUFFICIENT_MUSDT_AMOUNT');
        require(amountBkc >= amountBkcMin, 'BrokerLiquidityRouter: INSUFFICIENT_BKC_AMOUNT');

        TransferHelper.safeTransferFrom(musdt, msg.sender, pair, amountMusdt);
        IWBKC(WBKC).deposit{value: amountBkc}();
        require(IWBKC(WBKC).transfer(pair, amountBkc), 'BrokerLiquidityRouter: WBKC_TRANSFER_FAILED');
        liquidity = ILiquidityPair(pair).mint(to);
        require(liquidity >= liquidityMin, 'BrokerLiquidityRouter: INSUFFICIENT_LP_MINTED');
        if (msg.value > amountBkc) TransferHelper.safeTransferBKC(msg.sender, msg.value.sub(amountBkc));
    }

    function removeLiquidityBKC(
        uint liquidity,
        uint amountMusdtMin,
        uint amountBkcMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint amountMusdt, uint amountBkc) {
        require(to != address(0), 'BrokerLiquidityRouter: ZERO_RECIPIENT');
        require(ILiquidityPair(pair).transferFrom(msg.sender, pair, liquidity), 'BrokerLiquidityRouter: LP_TRANSFER_FAILED');
        (uint amount0, uint amount1) = ILiquidityPair(pair).burn(address(this));
        (amountMusdt, amountBkc) = musdt < WBKC ? (amount0, amount1) : (amount1, amount0);
        require(amountMusdt >= amountMusdtMin, 'BrokerLiquidityRouter: INSUFFICIENT_MUSDT_AMOUNT');
        require(amountBkc >= amountBkcMin, 'BrokerLiquidityRouter: INSUFFICIENT_BKC_AMOUNT');

        TransferHelper.safeTransfer(musdt, to, amountMusdt);
        IWBKC(WBKC).withdraw(amountBkc);
        TransferHelper.safeTransferBKC(to, amountBkc);
    }

    function _timestampSeconds() private view returns (uint) {
        return block.timestamp >= 100000000000 ? block.timestamp / 1000 : block.timestamp;
    }
}

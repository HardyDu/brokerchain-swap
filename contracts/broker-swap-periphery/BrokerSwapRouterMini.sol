// SPDX-License-Identifier: GPL-3.0-or-later
// Fixed-pair router for the BrokerSwap MVP: WBKC <-> mUSDT only.
pragma solidity =0.6.6;

import './interfaces/IWBKC.sol';
import './libraries/SafeMath.sol';
import './libraries/TransferHelper.sol';

interface IMiniFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IMiniPair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

contract BrokerSwapRouterMini {
    using SafeMath for uint;

    address public immutable factory;
    address public immutable WBKC;
    address public immutable musdt;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'BrokerSwapRouterMini: EXPIRED');
        _;
    }

    constructor(address _factory, address _WBKC, address _musdt) public {
        require(_factory != address(0) && _WBKC != address(0) && _musdt != address(0), 'BrokerSwapRouterMini: ZERO_ADDRESS');
        require(_WBKC != _musdt, 'BrokerSwapRouterMini: IDENTICAL_ADDRESSES');
        factory = _factory;
        WBKC = _WBKC;
        musdt = _musdt;
    }

    receive() external payable {
        require(msg.sender == WBKC, 'BrokerSwapRouterMini: BKC_REJECTED');
    }

    function pairAddr() public view returns (address) {
        return IMiniFactory(factory).getPair(WBKC, musdt);
    }

    function getReserves() public view returns (uint reserveMusdt, uint reserveWbkc) {
        address pair = pairAddr();
        require(pair != address(0), 'BrokerSwapRouterMini: NO_PAIR');
        (uint112 reserve0, uint112 reserve1,) = IMiniPair(pair).getReserves();
        return musdt < WBKC ? (uint(reserve0), uint(reserve1)) : (uint(reserve1), uint(reserve0));
    }

    function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts) {
        bool inputIsWbkc = _validatePath(path);
        (uint reserveMusdt, uint reserveWbkc) = getReserves();
        uint reserveIn = inputIsWbkc ? reserveWbkc : reserveMusdt;
        uint reserveOut = inputIsWbkc ? reserveMusdt : reserveWbkc;

        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = _getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        require(to != address(0), 'BrokerSwapRouterMini: ZERO_RECIPIENT');
        bool inputIsWbkc = _validatePath(path);
        amounts = getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, 'BrokerSwapRouterMini: INSUFFICIENT_OUTPUT_AMOUNT');

        address pair = pairAddr();
        TransferHelper.safeTransferFrom(path[0], msg.sender, pair, amountIn);
        _swap(pair, inputIsWbkc, amounts[1], to);
    }

    function swapExactBKCForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint[] memory amounts) {
        require(to != address(0), 'BrokerSwapRouterMini: ZERO_RECIPIENT');
        require(_validatePath(path), 'BrokerSwapRouterMini: INVALID_PATH');
        amounts = getAmountsOut(msg.value, path);
        require(amounts[1] >= amountOutMin, 'BrokerSwapRouterMini: INSUFFICIENT_OUTPUT_AMOUNT');

        address pair = pairAddr();
        IWBKC(WBKC).deposit{value: msg.value}();
        TransferHelper.safeTransfer(WBKC, pair, msg.value);
        _swap(pair, true, amounts[1], to);
    }

    function swapExactTokensForBKC(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        require(to != address(0), 'BrokerSwapRouterMini: ZERO_RECIPIENT');
        require(!_validatePath(path), 'BrokerSwapRouterMini: INVALID_PATH');
        amounts = getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, 'BrokerSwapRouterMini: INSUFFICIENT_OUTPUT_AMOUNT');

        address pair = pairAddr();
        TransferHelper.safeTransferFrom(musdt, msg.sender, pair, amountIn);
        _swap(pair, false, amounts[1], address(this));
        IWBKC(WBKC).withdraw(amounts[1]);
        TransferHelper.safeTransferBKC(to, amounts[1]);
    }

    function _validatePath(address[] memory path) private view returns (bool inputIsWbkc) {
        require(path.length == 2, 'BrokerSwapRouterMini: INVALID_PATH');
        if (path[0] == WBKC && path[1] == musdt) return true;
        require(path[0] == musdt && path[1] == WBKC, 'BrokerSwapRouterMini: INVALID_PATH');
        return false;
    }

    function _getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) private pure returns (uint amountOut) {
        require(amountIn > 0, 'BrokerSwapRouterMini: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'BrokerSwapRouterMini: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn.mul(997);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = amountInWithFee.mul(reserveOut) / denominator;
    }

    function _swap(address pair, bool inputIsWbkc, uint amountOut, address to) private {
        bool wbkcIsToken0 = WBKC < musdt;
        (uint amount0Out, uint amount1Out) = inputIsWbkc == wbkcIsToken0
            ? (uint(0), amountOut)
            : (amountOut, uint(0));
        IMiniPair(pair).swap(amount0Out, amount1Out, to, new bytes(0));
    }
}

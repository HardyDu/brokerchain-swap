// SPDX-License-Identifier: GPL-3.0-or-later
// Fixed-pair router for the BrokerSwap MVP: WBKC <-> mUSDT only.
pragma solidity =0.6.6;

import './interfaces/IWBKC.sol';
import './libraries/SafeMath.sol';
import './libraries/TransferHelper.sol';

interface IMiniFactoryV2 {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IMiniPairV2 {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

contract BrokerSwapRouterMiniV2 {
    using SafeMath for uint;

    address public immutable factory;
    address public immutable WBKC;
    address public immutable musdt;
    address public immutable pair;

    modifier ensure(uint deadline) {
        require(deadline >= _timestampSeconds(), 'BrokerSwapRouterMiniV2: EXPIRED');
        _;
    }

    constructor(address _factory, address _WBKC, address _musdt) public {
        require(_factory != address(0) && _WBKC != address(0) && _musdt != address(0), 'BrokerSwapRouterMiniV2: ZERO_ADDRESS');
        require(_WBKC != _musdt, 'BrokerSwapRouterMiniV2: IDENTICAL_ADDRESSES');
        factory = _factory;
        WBKC = _WBKC;
        musdt = _musdt;
        address _pair = IMiniFactoryV2(_factory).getPair(_WBKC, _musdt);
        require(_pair != address(0), 'BrokerSwapRouterMiniV2: NO_PAIR');
        pair = _pair;
    }

    receive() external payable {
        require(msg.sender == WBKC, 'BrokerSwapRouterMiniV2: BKC_REJECTED');
    }

    function pairAddr() public view returns (address) {
        return pair;
    }

    function getReserves() public view returns (uint reserveMusdt, uint reserveWbkc) {
        address pairAddress = pairAddr();
        require(pairAddress != address(0), 'BrokerSwapRouterMiniV2: NO_PAIR');
        (uint112 reserve0, uint112 reserve1,) = IMiniPairV2(pairAddress).getReserves();
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
        require(to != address(0), 'BrokerSwapRouterMiniV2: ZERO_RECIPIENT');
        bool inputIsWbkc = _validatePath(path);
        amounts = getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, 'BrokerSwapRouterMiniV2: INSUFFICIENT_OUTPUT_AMOUNT');

        address pairAddress = pairAddr();
        if (inputIsWbkc) {
            TransferHelper.safeTransferFrom(WBKC, msg.sender, pairAddress, amountIn);
        } else {
            _pullMusdt(pairAddress, amountIn);
        }
        _swap(pairAddress, inputIsWbkc, amounts[1], to);
    }

    function swapExactBKCForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint[] memory amounts) {
        require(to != address(0), 'BrokerSwapRouterMiniV2: ZERO_RECIPIENT');
        require(_validatePath(path), 'BrokerSwapRouterMiniV2: INVALID_PATH');
        amounts = getAmountsOut(msg.value, path);
        require(amounts[1] >= amountOutMin, 'BrokerSwapRouterMiniV2: INSUFFICIENT_OUTPUT_AMOUNT');

        address pairAddress = pairAddr();
        IWBKC(WBKC).deposit{value: msg.value}();
        TransferHelper.safeTransfer(WBKC, pairAddress, msg.value);
        _swap(pairAddress, true, amounts[1], to);
    }

    function swapExactTokensForBKC(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        require(to != address(0), 'BrokerSwapRouterMiniV2: ZERO_RECIPIENT');
        require(!_validatePath(path), 'BrokerSwapRouterMiniV2: INVALID_PATH');
        amounts = getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, 'BrokerSwapRouterMiniV2: INSUFFICIENT_OUTPUT_AMOUNT');

        address pairAddress = pairAddr();
        _pullMusdt(pairAddress, amountIn);
        _swap(pairAddress, false, amounts[1], address(this));
        IWBKC(WBKC).withdraw(amounts[1]);
        TransferHelper.safeTransferBKC(to, amounts[1]);
    }

    // BrokerChain-compatible fixed-pair entry points. amountOut is retained for
    // ABI compatibility but is never trusted: the current pool quote is used.
    function swapExactMusdtForWbkc(
        uint amountIn,
        uint,
        uint amountOutMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint) {
        require(to != address(0), 'BrokerSwapRouterMiniV2: ZERO_RECIPIENT');
        uint currentAmountOut = _currentAmountOut(amountIn, false);
        _validateQuote(amountIn, currentAmountOut, amountOutMin);

        _pullMusdt(pair, amountIn);
        _swap(pair, false, currentAmountOut, to);
        return currentAmountOut;
    }

    function swapExactBkcForMusdt(
        uint,
        uint amountOutMin,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint) {
        require(to != address(0), 'BrokerSwapRouterMiniV2: ZERO_RECIPIENT');
        uint currentAmountOut = _currentAmountOut(msg.value, true);
        _validateQuote(msg.value, currentAmountOut, amountOutMin);

        IWBKC(WBKC).deposit{value: msg.value}();
        TransferHelper.safeTransfer(WBKC, pair, msg.value);
        _swap(pair, true, currentAmountOut, to);
        return currentAmountOut;
    }

    function swapExactMusdtForBkc(
        uint amountIn,
        uint,
        uint amountOutMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint) {
        require(to != address(0), 'BrokerSwapRouterMiniV2: ZERO_RECIPIENT');
        uint currentAmountOut = _currentAmountOut(amountIn, false);
        _validateQuote(amountIn, currentAmountOut, amountOutMin);

        _pullMusdt(pair, amountIn);
        _swap(pair, false, currentAmountOut, address(this));
        IWBKC(WBKC).withdraw(currentAmountOut);
        TransferHelper.safeTransferBKC(to, currentAmountOut);
        return currentAmountOut;
    }

    function _pullMusdt(address pairAddress, uint amountIn) private {
        TransferHelper.safeTransferFrom(musdt, msg.sender, pairAddress, amountIn);
    }

    function _timestampSeconds() private view returns (uint) {
        // BrokerChain exposes block.timestamp in milliseconds, while wallets
        // and the Uniswap V2 ABI use Unix seconds. Standard EVM chains already
        // return a value below this threshold and are left unchanged.
        return block.timestamp >= 100000000000 ? block.timestamp / 1000 : block.timestamp;
    }

    function _validateQuote(uint amountIn, uint amountOut, uint amountOutMin) private pure {
        require(amountIn > 0, 'BrokerSwapRouterMiniV2: INSUFFICIENT_INPUT_AMOUNT');
        require(amountOut > 0, 'BrokerSwapRouterMiniV2: INSUFFICIENT_OUTPUT_AMOUNT');
        require(amountOut >= amountOutMin, 'BrokerSwapRouterMiniV2: INSUFFICIENT_OUTPUT_AMOUNT');
    }

    function _currentAmountOut(uint amountIn, bool inputIsWbkc) private view returns (uint) {
        (uint reserveMusdt, uint reserveWbkc) = getReserves();
        return _getAmountOut(amountIn,
            inputIsWbkc ? reserveWbkc : reserveMusdt,
            inputIsWbkc ? reserveMusdt : reserveWbkc);
    }

    function _validatePath(address[] memory path) private view returns (bool inputIsWbkc) {
        require(path.length == 2, 'BrokerSwapRouterMiniV2: INVALID_PATH');
        if (path[0] == WBKC && path[1] == musdt) return true;
        require(path[0] == musdt && path[1] == WBKC, 'BrokerSwapRouterMiniV2: INVALID_PATH');
        return false;
    }

    function _getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) private pure returns (uint amountOut) {
        require(amountIn > 0, 'BrokerSwapRouterMiniV2: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'BrokerSwapRouterMiniV2: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn.mul(997);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = amountInWithFee.mul(reserveOut) / denominator;
    }

    function _swap(address pairAddress, bool inputIsWbkc, uint amountOut, address to) private {
        bool wbkcIsToken0 = WBKC < musdt;
        (uint amount0Out, uint amount1Out) = inputIsWbkc == wbkcIsToken0
            ? (uint(0), amountOut)
            : (amountOut, uint(0));
        (bool success,) = pairAddress.call(
            abi.encodeWithSignature(
                'swap(uint256,uint256,address,bytes)',
                amount0Out,
                amount1Out,
                to,
                new bytes(0)
            )
        );
        require(success, 'BrokerSwapRouterMiniV2: PAIR_SWAP_FAILED');
    }
}

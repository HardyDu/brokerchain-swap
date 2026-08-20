// SPDX-License-Identifier: GPL-3.0-or-later
// Forked from Uniswap V2 Periphery — UniswapV2Router02.sol
// Renamed: ETH → BKC (BrokerChain native coin), WETH → WBKC (wrapped BKC).
//
// IMPORTANT naming convention:
//   "BKC"  = native BrokerChain coin (payable functions, similar to ETH path)
//   "WBKC" = wrapped BKC ERC-20 (the contract variable, was "WETH")
//   payable functions wrap native BKC into WBKC internally — do NOT name them "wBKC".
//
// Constructor: (address _factory, address _WBKC)
// receive() accepts native BKC only from the WBKC contract (withdraw path).

pragma solidity =0.6.6;

import '../broker-swap-core/interfaces/IUniswapV2Factory.sol';
import './libraries/TransferHelper.sol';

import './interfaces/IBrokerSwapRouter02.sol';
import './BrokerSwapLibrary.sol';
import './libraries/SafeMath.sol';
import './interfaces/IERC20.sol';
import './interfaces/IWBKC.sol';

contract BrokerSwapRouter is IBrokerSwapRouter02 {
    using SafeMath for uint;

    address public immutable override factory;
    address public immutable override WBKC;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'BrokerSwapRouter: EXPIRED');
        _;
    }

    constructor(address _factory, address _WBKC) public {
        factory = _factory;
        WBKC = _WBKC;
    }

    receive() external payable {
        assert(msg.sender == WBKC); // only accept BKC via fallback from the WBKC contract
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal virtual returns (uint amountA, uint amountB) {
        if (IUniswapV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            IUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = BrokerSwapLibrary.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = BrokerSwapLibrary.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'BrokerSwapRouter: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = BrokerSwapLibrary.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'BrokerSwapRouter: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = BrokerSwapLibrary.pairFor(factory, tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IUniswapV2Pair(pair).mint(to);
    }

    function addLiquidityBKC(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline
    ) external virtual override payable ensure(deadline) returns (uint amountToken, uint amountBKC, uint liquidity) {
        (amountToken, amountBKC) = _addLiquidity(
            token,
            WBKC,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountBKCMin
        );
        address pair = BrokerSwapLibrary.pairFor(factory, token, WBKC);
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        IWBKC(WBKC).deposit{value: amountBKC}();
        assert(IWBKC(WBKC).transfer(pair, amountBKC));
        liquidity = IUniswapV2Pair(pair).mint(to);
        if (msg.value > amountBKC) TransferHelper.safeTransferBKC(msg.sender, msg.value - amountBKC);
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        address pair = BrokerSwapLibrary.pairFor(factory, tokenA, tokenB);
        IUniswapV2Pair(pair).transferFrom(msg.sender, pair, liquidity);
        (uint amount0, uint amount1) = IUniswapV2Pair(pair).burn(to);
        (address token0,) = BrokerSwapLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'BrokerSwapRouter: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'BrokerSwapRouter: INSUFFICIENT_B_AMOUNT');
    }

    function removeLiquidityBKC(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountToken, uint amountBKC) {
        (amountToken, amountBKC) = removeLiquidity(
            token,
            WBKC,
            liquidity,
            amountTokenMin,
            amountBKCMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        IWBKC(WBKC).withdraw(amountBKC);
        TransferHelper.safeTransferBKC(to, amountBKC);
    }

    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountA, uint amountB) {
        address pair = BrokerSwapLibrary.pairFor(factory, tokenA, tokenB);
        uint value = approveMax ? uint(-1) : liquidity;
        IUniswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountA, amountB) = removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }

    function removeLiquidityBKCWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountToken, uint amountBKC) {
        address pair = BrokerSwapLibrary.pairFor(factory, token, WBKC);
        uint value = approveMax ? uint(-1) : liquidity;
        IUniswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountBKC) = removeLiquidityBKC(token, liquidity, amountTokenMin, amountBKCMin, to, deadline);
    }

    // **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
    function removeLiquidityBKCSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountBKC) {
        (, amountBKC) = removeLiquidity(
            token,
            WBKC,
            liquidity,
            amountTokenMin,
            amountBKCMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, IERC20(token).balanceOf(address(this)));
        IWBKC(WBKC).withdraw(amountBKC);
        TransferHelper.safeTransferBKC(to, amountBKC);
    }

    function removeLiquidityBKCWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountBKCMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountBKC) {
        address pair = BrokerSwapLibrary.pairFor(factory, token, WBKC);
        uint value = approveMax ? uint(-1) : liquidity;
        IUniswapV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        amountBKC = removeLiquidityBKCSupportingFeeOnTransferTokens(
            token, liquidity, amountTokenMin, amountBKCMin, to, deadline
        );
    }

    // **** SWAP ****
    function _swap(uint[] memory amounts, address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = BrokerSwapLibrary.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? BrokerSwapLibrary.pairFor(factory, output, path[i + 2]) : _to;
            IUniswapV2Pair(BrokerSwapLibrary.pairFor(factory, input, output)).swap(
                amount0Out, amount1Out, to, new bytes(0)
            );
        }
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        amounts = BrokerSwapLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }

    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        amounts = BrokerSwapLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'BrokerSwapRouter: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }

    function swapExactBKCForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        require(path[0] == WBKC, 'BrokerSwapRouter: INVALID_PATH');
        amounts = BrokerSwapLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWBKC(WBKC).deposit{value: amounts[0]}();
        assert(IWBKC(WBKC).transfer(BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
    }

    function swapTokensForExactBKC(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        require(path[path.length - 1] == WBKC, 'BrokerSwapRouter: INVALID_PATH');
        amounts = BrokerSwapLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'BrokerSwapRouter: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        IWBKC(WBKC).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferBKC(to, amounts[amounts.length - 1]);
    }

    function swapExactTokensForBKC(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        require(path[path.length - 1] == WBKC, 'BrokerSwapRouter: INVALID_PATH');
        amounts = BrokerSwapLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        IWBKC(WBKC).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferBKC(to, amounts[amounts.length - 1]);
    }

    function swapBKCForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        require(path[0] == WBKC, 'BrokerSwapRouter: INVALID_PATH');
        amounts = BrokerSwapLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= msg.value, 'BrokerSwapRouter: EXCESSIVE_INPUT_AMOUNT');
        IWBKC(WBKC).deposit{value: amounts[0]}();
        assert(IWBKC(WBKC).transfer(BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
        if (msg.value > amounts[0]) TransferHelper.safeTransferBKC(msg.sender, msg.value - amounts[0]);
    }

    // **** SWAP (supporting fee-on-transfer tokens) ****
    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = BrokerSwapLibrary.sortTokens(input, output);
            IUniswapV2Pair pair = IUniswapV2Pair(BrokerSwapLibrary.pairFor(factory, input, output));
            uint amountInput;
            uint amountOutput;
            {
            (uint reserve0, uint reserve1,) = pair.getReserves();
            (uint reserveInput, uint reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
            amountInput = IERC20(input).balanceOf(address(pair)).sub(reserveInput);
            amountOutput = BrokerSwapLibrary.getAmountOut(amountInput, reserveInput, reserveOutput);
            }
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOutput) : (amountOutput, uint(0));
            address to = i < path.length - 2 ? BrokerSwapLibrary.pairFor(factory, output, path[i + 2]) : _to;
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amountIn
        );
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }

    function swapExactBKCForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        payable
        ensure(deadline)
    {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        require(path[0] == WBKC, 'BrokerSwapRouter: INVALID_PATH');
        uint amountIn = msg.value;
        IWBKC(WBKC).deposit{value: amountIn}();
        assert(IWBKC(WBKC).transfer(BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amountIn));
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }

    function swapExactTokensForBKCSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
    {
        require(path.length >= 2, 'BrokerSwapRouter: INVALID_PATH');
        require(path[path.length - 1] == WBKC, 'BrokerSwapRouter: INVALID_PATH');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, BrokerSwapLibrary.pairFor(factory, path[0], path[1]), amountIn
        );
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint amountOut = IERC20(WBKC).balanceOf(address(this));
        require(amountOut >= amountOutMin, 'BrokerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWBKC(WBKC).withdraw(amountOut);
        TransferHelper.safeTransferBKC(to, amountOut);
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(uint amountA, uint reserveA, uint reserveB) public pure virtual override returns (uint amountB) {
        return BrokerSwapLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut)
        public
        pure
        virtual
        override
        returns (uint amountOut)
    {
        return BrokerSwapLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut)
        public
        pure
        virtual
        override
        returns (uint amountIn)
    {
        return BrokerSwapLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint amountIn, address[] memory path)
        public
        view
        virtual
        override
        returns (uint[] memory amounts)
    {
        return BrokerSwapLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint amountOut, address[] memory path)
        public
        view
        virtual
        override
        returns (uint[] memory amounts)
    {
        return BrokerSwapLibrary.getAmountsIn(factory, amountOut, path);
    }
}

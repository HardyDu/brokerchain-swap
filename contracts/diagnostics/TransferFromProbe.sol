// SPDX-License-Identifier: MIT
pragma solidity =0.6.6;

interface IProbeERC20 {
    function balanceOf(address owner) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);
}

contract TransferFromProbe {
    address public owner;

    event Snapshot(address indexed token, address indexed owner, address indexed spender, uint balance, uint allowanceValue);
    event ProbeResult(bool callSuccess, bool returnedTrue, bytes returnData, uint allowanceBefore, uint allowanceAfter);
    event StaticCallResult(address indexed target, bool callSuccess, bytes returnData);
    event StaticThenTransferResult(uint observedBalance, bool callSuccess, bool returnedTrue, bytes returnData);
    event CallResult(address indexed target, bool callSuccess, bytes returnData, bool valueRefunded);
    event TokenCallResult(address indexed token, bytes4 indexed selector, bool callSuccess, bytes returnData);
    event Timestamp(uint value);
    event SwapProbeResult(
        bool transferCallSuccess,
        bool transferReturnedTrue,
        bytes transferReturnData,
        bool swapCallSuccess,
        bytes swapReturnData,
        bool skimCallSuccess,
        bytes skimReturnData
    );

    modifier onlyOwner() {
        require(msg.sender == owner, 'TransferFromProbe: FORBIDDEN');
        _;
    }

    constructor() public {
        owner = msg.sender;
    }

    function emitTimestamp() external {
        emit Timestamp(block.timestamp);
    }

    function staticProbe(address target, bytes calldata callData) external {
        (bool callSuccess, bytes memory returnData) = target.staticcall(callData);
        emit StaticCallResult(target, callSuccess, returnData);
    }

    function callProbe(address target, bytes calldata callData) external payable onlyOwner {
        (bool callSuccess, bytes memory returnData) = target.call{value: msg.value}(callData);
        bool valueRefunded;
        if (!callSuccess && msg.value > 0) {
            (valueRefunded,) = msg.sender.call{value: msg.value}(new bytes(0));
            require(valueRefunded, 'TransferFromProbe: VALUE_REFUND_FAILED');
        }
        emit CallResult(target, callSuccess, returnData, valueRefunded);
    }

    function approveToken(address token, address spender, uint amount) external onlyOwner {
        (bool callSuccess, bytes memory returnData) = token.call(
            abi.encodeWithSelector(0x095ea7b3, spender, amount)
        );
        require(
            callSuccess && (returnData.length == 0 || abi.decode(returnData, (bool))),
            'TransferFromProbe: APPROVE_FAILED'
        );
        emit TokenCallResult(token, 0x095ea7b3, callSuccess, returnData);
    }

    function recoverToken(address token, address to, uint amount) external onlyOwner {
        (bool callSuccess, bytes memory returnData) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        require(
            callSuccess && (returnData.length == 0 || abi.decode(returnData, (bool))),
            'TransferFromProbe: RECOVER_FAILED'
        );
        emit TokenCallResult(token, 0xa9059cbb, callSuccess, returnData);
    }

    function probeStaticThenTransfer(address token, uint amount) external {
        uint observedBalance = IProbeERC20(token).balanceOf(msg.sender);
        (bool callSuccess, bytes memory returnData) = token.call(
            abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)
        );
        bool returnedTrue = callSuccess && (returnData.length == 0 || abi.decode(returnData, (bool)));

        if (returnedTrue) {
            (bool refundSuccess, bytes memory refundData) = token.call(
                abi.encodeWithSelector(0xa9059cbb, msg.sender, amount)
            );
            require(
                refundSuccess && (refundData.length == 0 || abi.decode(refundData, (bool))),
                'TransferFromProbe: REFUND_FAILED'
            );
        }

        emit StaticThenTransferResult(observedBalance, callSuccess, returnedTrue, returnData);
    }

    function snapshot(address token, address tokenOwner, address spender) external {
        emit Snapshot(
            token,
            tokenOwner,
            spender,
            IProbeERC20(token).balanceOf(tokenOwner),
            IProbeERC20(token).allowance(tokenOwner, spender)
        );
    }

    function probe(address token, uint amount) external {
        uint allowanceBefore = IProbeERC20(token).allowance(msg.sender, address(this));
        (bool callSuccess, bytes memory returnData) = token.call(
            abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)
        );
        bool returnedTrue = callSuccess && (returnData.length == 0 || abi.decode(returnData, (bool)));

        if (returnedTrue) {
            (bool refundSuccess, bytes memory refundData) = token.call(
                abi.encodeWithSelector(0xa9059cbb, msg.sender, amount)
            );
            require(
                refundSuccess && (refundData.length == 0 || abi.decode(refundData, (bool))),
                'TransferFromProbe: REFUND_FAILED'
            );
        }

        emit ProbeResult(
            callSuccess,
            returnedTrue,
            returnData,
            allowanceBefore,
            IProbeERC20(token).allowance(msg.sender, address(this))
        );
    }

    function probeSwap(
        address tokenIn,
        address pair,
        uint amountIn,
        uint amount0Out,
        uint amount1Out,
        address to
    ) external {
        (bool transferCallSuccess, bytes memory transferReturnData) = tokenIn.call(
            abi.encodeWithSelector(0x23b872dd, msg.sender, pair, amountIn)
        );
        bool transferReturnedTrue = transferCallSuccess && (
            transferReturnData.length == 0 || abi.decode(transferReturnData, (bool))
        );
        bool swapCallSuccess;
        bytes memory swapReturnData;
        bool skimCallSuccess;
        bytes memory skimReturnData;

        if (transferReturnedTrue) {
            (swapCallSuccess, swapReturnData) = pair.call(
                abi.encodeWithSignature(
                    'swap(uint256,uint256,address,bytes)',
                    amount0Out,
                    amount1Out,
                    to,
                    new bytes(0)
                )
            );
            if (!swapCallSuccess) {
                (skimCallSuccess, skimReturnData) = pair.call(
                    abi.encodeWithSignature('skim(address)', msg.sender)
                );
            }
        }

        emit SwapProbeResult(
            transferCallSuccess,
            transferReturnedTrue,
            transferReturnData,
            swapCallSuccess,
            swapReturnData,
            skimCallSuccess,
            skimReturnData
        );
    }
}

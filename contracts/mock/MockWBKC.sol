// SPDX-License-Identifier: GPL-3.0-or-later
// Mock WBKC — IWBKC-compatible test double for BrokerChain native wrapped coin.
// Implements deposit(), withdraw(), and standard ERC-20 behaviors.

pragma solidity =0.6.6;

contract MockWBKC {
    string public name = "Wrapped BKC";
    string public symbol = "WBKC";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed to, uint256 value);
    event Withdrawal(address indexed from, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() public view returns (uint256) {
        return address(this).balance;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 value) external {
        require(balanceOf[msg.sender] >= value, "MockWBKC: insufficient balance");
        balanceOf[msg.sender] -= value;
        (bool success, ) = msg.sender.call{value: value}("");
        require(success, "MockWBKC: BKC transfer failed");
        emit Withdrawal(msg.sender, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "MockWBKC: insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "MockWBKC: insufficient balance");
        if (allowance[from][msg.sender] != uint256(-1)) {
            require(allowance[from][msg.sender] >= value, "MockWBKC: insufficient allowance");
            allowance[from][msg.sender] -= value;
        }
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }

    // receive() wraps native BKC identically to deposit(), so that direct
    // transfers to MockWBKC (e.g. from Router withdraw refunds) mint WBKC.
    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }
}

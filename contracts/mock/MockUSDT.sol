// SPDX-License-Identifier: GPL-3.0-or-later
// Mock USDT (mUSDT) for BrokerChain (chainId 4176) swap testing.
// Standard ERC-20 with owner-only mint. No fee-on-transfer, no rebasing, no blacklist.

pragma solidity =0.6.6;

contract MockUSDT {
    string public name = "Mock USDT";
    string public symbol = "mUSDT";
    uint8 public decimals = 6;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "MockUSDT: only owner");
        _;
    }

    constructor() public {
        owner = msg.sender;
        // Initial supply: 1,000,000 mUSDT (1 million with 6 decimals)
        uint256 initialSupply = 1000000 * 10**6;
        balanceOf[msg.sender] = initialSupply;
        totalSupply = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MockUSDT: mint to zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockUSDT: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockUSDT: insufficient balance");
        if (allowance[from][msg.sender] != uint256(-1)) {
            require(allowance[from][msg.sender] >= amount, "MockUSDT: insufficient allowance");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

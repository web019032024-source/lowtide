import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSwap } from "../src/indexer/swaps.js";
const TOKEN="0x0000000000000000000000000000000000000002", QUOTE="0x0000000000000000000000000000000000000001"; // quote is token0
test("v3 swap: pool loses token → buy, price from quote leg", () => {
  const log={transaction_hash:"0xabc",block_number:10,block_timestamp:"2026-09-03T12:00:00Z",decoded:{method_call:"Swap(address sender, address recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
    parameters:[{name:"sender",type:"address",value:"0xaa"},{name:"recipient",type:"address",value:"0xBB"},{name:"amount0",value:"1000000000000000000"},{name:"amount1",value:"-2000000000000000000000"}]}};
  const s=decodeSwap(log,TOKEN,QUOTE,18,18,3000);
  assert.equal(s.side,"buy"); assert.equal(s.usd,3000); assert.equal(s.price_usd,1.5); assert.equal(s.wallet,"0xbb");
});
test("v2 swap: token in → sell", () => {
  const log={tx_hash:"0xdef",block_number:11,decoded:{method_call:"Swap(address sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address to)",
    parameters:[{name:"amount0In",value:"0"},{name:"amount1In",value:"500000000000000000000"},{name:"amount0Out",value:"250000000000000000"},{name:"amount1Out",value:"0"},{name:"to",type:"address",value:"0xcc"}]}};
  const s=decodeSwap(log,TOKEN,QUOTE,18,18,3000);
  assert.equal(s.side,"sell"); assert.equal(s.usd,750); assert.equal(s.price_usd,1.5); assert.equal(s.block,11);
});
test("non-swap logs are ignored", () => { assert.equal(decodeSwap({decoded:{method_call:"Transfer(address,address,uint256)",parameters:[]}},TOKEN,QUOTE,18,18,1),null); });

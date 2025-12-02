#!/usr/bin/env python3
import json, sys, os, asyncio
from decimal import Decimal, getcontext

getcontext().prec = 50

USDT  = "0x05d032ac25d322df992303dca074ee7392c117b9"
USDT0 = "0x43f2376d5d03553ae72f4a8093bbe9de4336eb08"
DEFAULT_RPC = "https://rpc.api.lisk.com"

def to_human(amount_wei: int, decimals: int) -> Decimal:
    return Decimal(amount_wei) / (Decimal(10) ** decimals)

async def run(amount_wei: int, rpc: str,  account: str, slippage: float | None):
    from sugar.chains import AsyncLiskChain
    from sugar.swap import setup_planner


    async with AsyncLiskChain(rpc_uri=rpc) as chain:
        # Resolve tokens by address (SDK-version agnostic)
        tokens = await chain.get_all_tokens()
        by_addr = {t.token_address.lower(): t for t in tokens}
        usdt  = by_addr.get(USDT.lower())
        usdt0 = by_addr.get(USDT0.lower())
        if not (usdt and usdt0):
            return {"ok": False, "error": "token_map_missing"}

        dec_in  = int(getattr(usdt,  "decimals", 6))
        dec_out = int(getattr(usdt0, "decimals", 6))

        # Convert base units -> human and pass as STRING (avoid Decimal type surprises)
        amount_human_str = (to_human(amount_wei, dec_in))

        amountPassed = int(usdt.parse_units(amount_human_str))

        # Sugar SDK on your env expects `amount` (human units)
        quote = await chain.get_quote(from_token=usdt, to_token=usdt0, amount=amountPassed)
        if not quote:
            return {"ok": False, "error": "no_route"}
        
   

        # Normalize amountOut to base units (int)
        out_wei = getattr(quote, "amount_out_wei", None)
        if out_wei is None:
            out_human = getattr(quote, "amount_out", None)
            if out_human is None:
                return {"ok": False, "error": "bad_quote_shape"}
            # out_human can be str/Decimal/float; coerce via Decimal then scale
            out_wei = int(Decimal(str(out_human)) * (Decimal(10) ** dec_out))


        swapper = chain.settings.swapper_contract_addr
        swap_slippage = slippage if slippage is not None else getattr(chain.settings, "swap_slippage", 0.003)  # ~0.3% default
        planner = setup_planner(
            quote=quote,
            slippage=swap_slippage,
            account=account,
            router_address=swapper,
        )

        cmds = getattr(planner, "commands", b"")
        ins  = getattr(planner, "inputs", []) or []

        def to_hex_bytes(data) -> str:
            if data is None:
                return "0x"
            if isinstance(data, (bytes, bytearray, memoryview)):
                return "0x" + bytes(data).hex()
            if isinstance(data, str):
                # already hex? else treat as hex without 0x
                return data if data.startswith("0x") else "0x" + data
            if isinstance(data, (list, tuple)):
                # list/tuple of ints (0..255) or bytes-like
                try:
                    return "0x" + bytes(data).hex()
                except TypeError:
                    return "0x" + bytearray(data).hex()
            # last resort: try buffer protocol
            return "0x" + bytes(data).hex()

        commands_hex = to_hex_bytes(getattr(planner, "commands", b""))
        inputs_hex = [to_hex_bytes(x) for x in (getattr(planner, "inputs", []) or [])]

        # ETH value only when swapping native (not our USDT case)
        from_token = getattr(quote, "from_token", None)
        is_native = bool(getattr(from_token, "wrapped_token_address", None)) and str(getattr(from_token, "token_address", "")).lower() in ("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "0x0000000000000000000000000000000000000000")
        value = int(amount_wei) if is_native else 0

        return {
            "ok": True,
            "amountOut": int(to_human(out_wei,6)),
            "plan": {
                "to": swapper,
                "commands": commands_hex,
                "inputs": inputs_hex,
                "value": str(value),
            },
        }

       

def main():
    payload = json.loads(sys.stdin.read() or "{}")

    amt = int(str(payload.get("amountInWei", "0")))
    account = payload.get("account")
    if not account:
        print(json.dumps({"ok": False, "error": "missing_account"}))
        return

    # optional slippage (float, e.g., 0.003 for 0.3%)
    slippage = payload.get("slippage")
    try:
        if slippage is not None:
            slippage = float(slippage)
    except Exception:
        slippage = None

    rpc = os.getenv("SUGAR_RPC_URI_1135", DEFAULT_RPC)
    res = asyncio.run(run(amt, rpc, account, slippage))
    print(json.dumps(res))
if __name__ == "__main__":
    main()

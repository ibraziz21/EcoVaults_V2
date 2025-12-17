"use client"

import { X } from "lucide-react"
import Image from "next/image"

type PrimitiveNumber = number | string | bigint | null | undefined

interface Token {
  id: string
  name: string
  symbol: string
  icon: string
  balance: PrimitiveNumber
  address: string
}

interface SelectTokenModalProps {
  tokens: Token[]
  selectedToken: Token
  onSelect: (token: Token) => void
  onClose: () => void
}

function truncateAddress(addr: string, head = 6, tail = 4) {
  if (!addr || addr.length <= head + tail + 3) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

function toNumber(val: PrimitiveNumber): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0
  if (typeof val === "bigint") return Number(val)
  if (typeof val === "string") {
    const n = Number(val)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export function SelectTokenModal({
  tokens,
  selectedToken,
  onSelect,
  onClose,
}: SelectTokenModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[20px] w-full max-w-md shadow-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-gray-200">
          <h2 className="text-lg md:text-xl font-bold text-gray-900">Select a token</h2>
          <button
            onClick={onClose}
            className=" cursor-pointer p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
            title="Close"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Token List */}
        <div className="max-h-[60vh] overflow-y-auto">
          {tokens.map((token) => {
            const balNum = toNumber(token.balance)
            const isSelected = token.id === selectedToken.id
            return (
              <button
                key={token.id}
                onClick={() => onSelect(token)}
                className={` cursor-pointer w-full px-4 py-3 md:px-6 md:py-4 transition-all flex items-center justify-between group text-left border-b border-gray-100 last:border-b-0 ${
                  isSelected
                    ? "bg-[#F9FAFB] hover:bg-[#F9FAFB]"
                    : "bg-white hover:bg-[#F9FAFB]"
                }`}
              >
                <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 md:w-12 md:h-12 relative shrink-0">
                    <Image
                      src={token.icon}
                      alt={token.symbol}
                      width={48}
                      height={48}
                      className="rounded-full"
                    />
                    {/* Network badge - square with rounded-md */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-md border-2 border-white bg-white overflow-hidden">
                      <Image
                        src={
                          token.id.includes('_lisk')
                            ? '/networks/lisk.png'
                            : '/networks/op-icon.png'
                        }
                        alt="network"
                        width={20}
                        height={20}
                        className="rounded-none"
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-base md:text-lg text-gray-900 truncate">
                      {token.name}
                    </p>
                    <p
                      className="text-xs md:text-sm text-gray-500 font-mono truncate"
                      title={token.address}
                    >
                      {truncateAddress(token.address)}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0 ml-3">
                  <p className="font-semibold text-gray-900 text-base md:text-lg">
                    {balNum.toFixed(2)}
                  </p>
                  <p className="text-xs md:text-sm text-gray-500">
                    ${balNum.toFixed(2)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
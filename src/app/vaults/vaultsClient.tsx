// src/app/positions/page.tsx
"use client";

import { useState } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import Vaults from "@/components/tables/VaultsTable/Vaults";
import MyPositions from "@/components/tables/MyPositionsTable/MyPositions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Base from "../../../public/networks/base.png"
import Unichain from "../../../public/networks/unichain.png"
import WorldCoin from "../../../public/networks/worldcoin.png"
import Lisk from "../../../public/networks/lisk.png"
import OpIcon from "../../../public/networks/op-icon.png"
import MorphoIcon from "../../../public/protocols/morpho-icon.png"
import MerkleIcon from "../../../public/protocols/merkle.png"

import { usePositions } from "@/hooks/usePositions";
import { MultiSelectComboBox } from "@/components/multi-select-combobox";
import Image from "next/image";


export default function PositionsPage() {
  const { address, isConnected } = useAppKitAccount();

  // Filter options
  const networkOptions = [
    {
      value: "Lisk",
      label: "Lisk",
      icon: <Image src={Lisk} alt="Lisk" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Base",
      label: "Base",
      icon: <Image src={Base} alt="Base" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Unichain",
      label: "Unichain",
      icon: <Image src={Unichain} alt="Unichain" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Op Mainnet",
      label: "Op Mainnet",
      icon: <Image src={OpIcon} alt="OpIcon" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "World Chain",
      label: "World Chain",
      icon: <Image src={WorldCoin} alt="WorldCoin" className="h-4 w-4 rounded-[4px]" />
    },
  ];

  const protocolOptions = [
    {
      value: "Morpho Blue",
      label: "Morpho Blue",
      icon: <Image src={MorphoIcon} alt="Morpho Blue" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Merkle",
      label: "Merkle",
      icon: <Image src={MerkleIcon} alt="Merkle" className="h-4 w-4 rounded-[4px]" />
    },
  ];

  // Multi-select state - empty array means "show all"
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([]);
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>([]);

  const { data: positionsRaw } = usePositions();

  // Simplified toggle handlers
  const handleNetworkToggle = (network: string) => {
    setSelectedNetworks((prev) => {
      if (prev.includes(network)) {
        const newSelection = prev.filter((n) => n !== network);
        return newSelection;
      } else {
        return [...prev, network];
      }
    });
  };

  const handleProtocolToggle = (protocol: string) => {
    setSelectedProtocols((prev) => {
      if (prev.includes(protocol)) {
        const newSelection = prev.filter((p) => p !== protocol);
        return newSelection;
      } else {
        return [...prev, protocol];
      }
    });
  };

  // Reusable filter UI
  const filterUI = (
    <div className="flex items-center gap-3 md:gap-4 px-2 py-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Network:</span>
        <MultiSelectComboBox
          options={networkOptions}
          selectedValues={selectedNetworks}
          onToggle={handleNetworkToggle}
          placeholder="network"
          allLabel="All"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Protocol:</span>
        <MultiSelectComboBox
          options={protocolOptions}
          selectedValues={selectedProtocols}
          onToggle={handleProtocolToggle}
          placeholder="protocol"
          allLabel="All"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-3.5rem)] w-full px-4">
      <section className="w-full max-w-[1392px] mx-auto bg-[#FFFFFF] my-4 p-4 md:p-6 rounded-xl">
        <Tabs defaultValue="vaults" className="w-full">
          <TabsList className="mb-4 bg-white">
            <TabsTrigger
              className={`font-normal ${positionsRaw && positionsRaw.length <= 0 ? "hidden" : "flex"}`}
              value="positions"
            >
              Your Positions
              <div className="bg-[#E5E7EB] mx-1 px-1 py-[2px] rounded-full flex items-center justify-center h-[18px] w-[18px] text-[11px] font-medium leading-none">
                {positionsRaw?.length ?? 0}
              </div>
            </TabsTrigger>
            <TabsTrigger className="font-normal" value="vaults">
              Vaults
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            <MyPositions
              networkFilter={selectedNetworks}
              protocolFilter={selectedProtocols}
              filterUI={filterUI}
            />
          </TabsContent>

          <TabsContent value="vaults">
            <Vaults
              networkFilter={selectedNetworks}
              protocolFilter={selectedProtocols}
              filterUI={filterUI}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
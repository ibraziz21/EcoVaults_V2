// src/app/positions/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import Vaults from "@/components/tables/VaultsTable/Vaults";
import MyPositions from "@/components/tables/MyPositionsTable/MyPositions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConnectWalletPrompt } from "@/components/ConnectWalletPrompt";
import { FunnelSimpleIcon } from "@phosphor-icons/react";
import { usePositions } from "@/hooks/usePositions";

export default function PositionsPage() {
  const { address, isConnected } = useAppKitAccount();

  // Multi-select state for filters
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>(["all"]);
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>(["all"]);
  const [showNetworkFilter, setShowNetworkFilter] = useState(false);
  const [showProtocolFilter, setShowProtocolFilter] = useState(false);

  const { data: positionsRaw } = usePositions();

  // Refs for detecting outside clicks
  const networkFilterRef = useRef<HTMLDivElement>(null);
  const protocolFilterRef = useRef<HTMLDivElement>(null);

  // Close filters when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideNetwork = networkFilterRef.current?.contains(target);
      const isInsideProtocol = protocolFilterRef.current?.contains(target);

      if (!isInsideNetwork && !isInsideProtocol) {
        setShowNetworkFilter(false);
        setShowProtocolFilter(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Toggle handler for network checkboxes
  const handleNetworkToggle = (network: string) => {
    if (network === "all") {
      setSelectedNetworks(["all"]);
    } else {
      setSelectedNetworks((prev) => {
        const filtered = prev.filter((n) => n !== "all");
        if (filtered.includes(network)) {
          const newSelection = filtered.filter((n) => n !== network);
          return newSelection.length > 0 ? newSelection : ["all"];
        } else {
          return [...filtered, network];
        }
      });
    }
  };

  // Toggle handler for protocol checkboxes
  const handleProtocolToggle = (protocol: string) => {
    if (protocol === "all") {
      setSelectedProtocols(["all"]);
    } else {
      setSelectedProtocols((prev) => {
        const filtered = prev.filter((p) => p !== "all");
        if (filtered.includes(protocol)) {
          const newSelection = filtered.filter((p) => p !== protocol);
          return newSelection.length > 0 ? newSelection : ["all"];
        } else {
          return [...filtered, protocol];
        }
      });
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] w-full px-4">
      <section className="bg-[#FFFFFF] my-4 p-4 md:p-6 rounded-xl max-w-6xl mx-auto">
        <Tabs defaultValue="vaults" className="w-full">
          <TabsList className="mb-4 bg-white ">
            <TabsTrigger className="font-normal" value="positions">
              Your Positions
              <div className="bg-[#E5E7EB] mx-1 px-2 py-1 rounded-full flex items-center justify-center min-w-[28px] h-7 text-sm font-medium leading-none">
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
              filterUI={
                <div className="flex items-center gap-3 md:gap-4 px-2 py-3 flex-wrap">
                  {/* Network Filter */}
                  <div className="flex items-center gap-2" ref={networkFilterRef}>
                    <span className="text-sm font-medium text-gray-700">
                      Network:
                    </span>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowNetworkFilter(!showNetworkFilter);
                          setShowProtocolFilter(false);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg  px-2.5 py-1 text-sm font-medium transition-colors ${
                          selectedNetworks.length > 0 &&
                          !selectedNetworks.includes("all")
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-300 bg-white hover:bg-gray-50"
                        }`}
                        title="Filter by network"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
                        {selectedNetworks.includes("all") ||
                        selectedNetworks.length === 0
                          ? "All"
                          : selectedNetworks.join(", ")}
                      </button>

                      {showNetworkFilter && (
                        <div className="absolute left-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedNetworks.includes("all")}
                              onChange={() => handleNetworkToggle("all")}
                            />
                            All Networks
                          </label>
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedNetworks.includes("Lisk")}
                              onChange={() => handleNetworkToggle("Lisk")}
                            />
                            Lisk
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Protocol Filter */}
                  <div className="flex items-center gap-2" ref={protocolFilterRef}>
                    <span className="text-sm font-medium text-gray-700">
                      Protocol:
                    </span>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowProtocolFilter(!showProtocolFilter);
                          setShowNetworkFilter(false);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors ${
                          selectedProtocols.length > 0 &&
                          !selectedProtocols.includes("all")
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-300 bg-white hover:bg-gray-50"
                        }`}
                        title="Filter by protocol"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
                        {selectedProtocols.includes("all") ||
                        selectedProtocols.length === 0
                          ? "All"
                          : selectedProtocols.join(", ")}
                      </button>

                      {showProtocolFilter && (
                        <div className="absolute left-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedProtocols.includes("all")}
                              onChange={() => handleProtocolToggle("all")}
                            />
                            All Protocols
                          </label>
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedProtocols.includes("Morpho Blue")}
                              onChange={() => handleProtocolToggle("Morpho Blue")}
                            />
                            Morpho Blue
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              }
            />
          </TabsContent>

          <TabsContent value="vaults">
            <Vaults
              networkFilter={selectedNetworks}
              protocolFilter={selectedProtocols}
              filterUI={
                <div className="flex items-center gap-3 md:gap-4 px-2 py-3 flex-wrap">
                  {/* Network Filter */}
                  <div className="flex items-center gap-2" ref={networkFilterRef}>
                    <span className="text-sm font-medium text-gray-700">
                      Network:
                    </span>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowNetworkFilter(!showNetworkFilter);
                          setShowProtocolFilter(false);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors ${
                          selectedNetworks.length > 0 &&
                          !selectedNetworks.includes("all")
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-300 bg-white hover:bg-gray-50"
                        }`}
                        title="Filter by network"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
                        {selectedNetworks.includes("all") ||
                        selectedNetworks.length === 0
                          ? "All"
                          : selectedNetworks.join(", ")}
                      </button>

                      {showNetworkFilter && (
                        <div className="absolute left-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedNetworks.includes("all")}
                              onChange={() => handleNetworkToggle("all")}
                            />
                            All Networks
                          </label>
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedNetworks.includes("Lisk")}
                              onChange={() => handleNetworkToggle("Lisk")}
                            />
                            Lisk
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Protocol Filter */}
                  <div className="flex items-center gap-2" ref={protocolFilterRef}>
                    <span className="text-sm font-medium text-gray-700">
                      Protocol:
                    </span>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowProtocolFilter(!showProtocolFilter);
                          setShowNetworkFilter(false);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors ${
                          selectedProtocols.length > 0 &&
                          !selectedProtocols.includes("all")
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-300 bg-white hover:bg-gray-50"
                        }`}
                        title="Filter by protocol"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
                        {selectedProtocols.includes("all") ||
                        selectedProtocols.length === 0
                          ? "All"
                          : selectedProtocols.join(", ")}
                      </button>

                      {showProtocolFilter && (
                        <div className="absolute left-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedProtocols.includes("all")}
                              onChange={() => handleProtocolToggle("all")}
                            />
                            All Protocols
                          </label>
                          <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={selectedProtocols.includes("Morpho Blue")}
                              onChange={() => handleProtocolToggle("Morpho Blue")}
                            />
                            Morpho Blue
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              }
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

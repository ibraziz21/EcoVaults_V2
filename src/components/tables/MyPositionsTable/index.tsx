
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import React from "react";
import { DataTable } from "../data-table";
import { normalizeVaultRoute } from "../VaultsTable";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";


interface TblProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyMessage?: string;
  emptySubMessage?: string;
  filterUI?: React.ReactNode;
}

export default function MyPositionsTable<TData, TValue>({
  columns,
  data,
  emptyMessage,
  emptySubMessage,
  filterUI,
}: TblProps<TData, TValue>) {
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const router = useRouter();

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    state: {
      columnFilters,
      sorting,
    },
  });

  const handleRowClick = (row: any) => {
    // Prefer a canonical key if your data rows provide it (recommended):
    // e.g. in Vaults.tsx, set `routeKey: 'USDCe' | 'USDT0'`
    const routeKey = row.original?.routeKey as string | undefined;

    // Otherwise, normalize from display label (USDC.e -> USDCe, USDT0 -> USDT0, etc.)
    const display = (row.original?.vault as string) ?? "";
    const vaultParam = routeKey ?? normalizeVaultRoute(display);

    router.push(`/vaults/${encodeURIComponent(vaultParam)}`);
  };

  return (
    <DataTable showExploreVaultsButton={true} table={table} columns={columns} data={data} onRowClick={handleRowClick} emptyMessage={emptyMessage} emptySubMessage={emptySubMessage}>
      <div className="flex justify-between items-center mx-5">
        {filterUI}
        <div className="flex items-center bg-[#F3F4F6] rounded-full px-2 h-full">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.63457 9.71L11.95 11.95M11.2033 5.97667C11.2033 8.86328 8.86328 11.2033 5.97667 11.2033C3.09006 11.2033 0.75 8.86328 0.75 5.97667C0.75 3.09006 3.09006 0.75 5.97667 0.75C8.86328 0.75 11.2033 3.09006 11.2033 5.97667Z" stroke="#4B5563" stroke-width="1.5" stroke-linecap="round" />
          </svg>

          <input
            type="text"
            className="outline-none p-1 text-[12px]"
            placeholder="Search vaults"
            value={(table.getColumn("vault")?.getFilterValue() as string) ?? ""}
            onChange={(event: React.FormEvent<HTMLInputElement>) => {
              table
                .getColumn("vault")
                ?.setFilterValue(event.currentTarget.value);
            }}
          />
        </div>
      </div>
    </DataTable>
  );
}

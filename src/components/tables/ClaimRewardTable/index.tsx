// src/components/ClaimRewards/index.tsx  (a.k.a. ClaimRewardTable)
'use client'

import React from 'react'
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { DataTable } from '../data-table'

interface TblProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: any // forward table meta (for onClaim, isClaiming, priceUsdForSymbol)
  isLoading?: boolean // optional passthrough (kept for compatibility)
  emptyMessage?: string
  emptySubMessage?: string
}

export default function ClaimRewardTable<TData, TValue>({
  columns,
  data,
  meta,
  emptyMessage,
  emptySubMessage,
}: TblProps<TData, TValue>) {
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    meta,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    state: { columnFilters, sorting },
  })

  return (
    <DataTable
      showExploreVaultsButton={false}
      table={table}
      columns={columns}
      data={data}
      emptyMessage={emptyMessage}
      emptySubMessage={emptySubMessage}
    />
  )
}

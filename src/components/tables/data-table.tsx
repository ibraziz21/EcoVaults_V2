// src/components/data-table.tsx  (SA Implementation)
'use client'

import * as React from 'react'
import type { ColumnDef, Table as TableTanstack } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  children?: React.ReactNode
  table: TableTanstack<TData>
  onRowClick?: (row: any) => void
  emptyMessage?: string
  emptySubMessage?: string
  showExploreVaultsButton?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  children,
  table,
  onRowClick,
  emptyMessage = 'No results.',
  emptySubMessage,
  showExploreVaultsButton = false,
}: DataTableProps<TData, TValue>) {
  const router = useRouter()
  const { pageIndex } = table.getState().pagination

  // (kept for parity with your current file; render wherever you already do)
  const paginationButtons: React.ReactNode[] = []
  const pageCount = table.getPageCount()
  if (pageCount) {
    for (let i = 0; i < pageCount; i++) {
      paginationButtons.push(
        <Button
          key={i}
          className={`ml-1 ${i === pageIndex ? 'bg-[#7CE27E] text-white' : ''}`}
          variant="outline"
          size="sm"
          onClick={() => table.setPageIndex(i)}
        >
          {i + 1}
        </Button>,
      )
    }
  }

  return (
    <div>
      <div className="rounded-[20px] bg-white border my-3 overflow-hidden">
        {children}

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  onClick={() => onRowClick?.(row)}
                  className={
                    onRowClick
                      ? 'cursor-pointer hover:bg-gray-50 transition-colors'
                      : ''
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              // IMPORTANT: prevent hover styling + pointer on empty state row
              <TableRow className="hover:bg-transparent cursor-default">
                <TableCell
                  colSpan={columns.length}
                  className="h-[52px] text-center"
                >
                  <div className="flex flex-col items-center justify-center py-[48px]">
                    <p className="text-sm text-black font-medium">
                      {emptyMessage}
                    </p>

                    {emptySubMessage && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {emptySubMessage}
                      </p>
                    )}

                    {showExploreVaultsButton && (
                      <Button
                        variant="default"
                        size="sm"
                        className="mt-4"
                        onClick={() => router.push('/vaults')}
                      >
                        Explore Vaults
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* If you already render pagination elsewhere, keep it there.
            If not, you can place it here and style as needed:
            <div className="p-4 flex justify-end">{paginationButtons}</div>
        */}
      </div>
    </div>
  )
}

export type PaginationState = {
  pageIndex: number
  pageSize: number
}

export type PaginationTableState = {
  pagination: PaginationState
}

export type PaginationInitialTableState = {
  pagination?: Partial<PaginationState>
}

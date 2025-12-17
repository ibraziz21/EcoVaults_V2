import { cn } from "@/lib/utils";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
} from "@radix-ui/react-icons";
import { Column } from "@tanstack/react-table";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const sorted = column.getIsSorted();

  // Non-sortable: plain label
  if (!column.getCanSort()) {
    return (
      <div className={cn("flex items-center justify-start", className)}>
        <span className="text-xs font-medium text-[#4B5563]">{title}</span>
      </div>
    );
  }

  // Sortable: click to toggle (1st: desc, 2nd: asc, 3rd: reset)
  const handleSort = () => {
    if (sorted === false) {
      column.toggleSorting(true);
    } else if (sorted === 'desc') {
      column.toggleSorting(false);
    } else {
      column.clearSorting();
    }
  };

  return (
    <div className={cn("flex items-center justify-start", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleSort}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSort();
          }
        }}
        className="flex items-center text-[#4B5563] text-xs font-medium cursor-pointer select-none p-0 hover:text-[#4B5563] focus:outline-none"
      >
        <span>{title}</span>
        {sorted === 'desc' ? (
          <ArrowDownIcon className="ml-2 h-4 min-w-[16px]" />
        ) : sorted === 'asc' ? (
          <ArrowUpIcon className="ml-2 h-4 min-w-[16px]" />
        ) : (
          <CaretSortIcon className="ml-2 h-4 min-w-[16px]" />
        )}
      </div>
    </div>
  );
}
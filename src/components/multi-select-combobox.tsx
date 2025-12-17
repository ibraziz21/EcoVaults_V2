"use client"

import * as React from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { FunnelSimpleIcon } from "@phosphor-icons/react"

export interface MultiSelectOption {
  value: string
  label: string
  icon?: React.ReactNode // Optional icon
}

interface MultiSelectComboBoxProps {
  options: MultiSelectOption[]
  selectedValues: string[]
  onToggle: (value: string) => void
  placeholder: string
  allLabel: string
  onClearAll?: () => void // Optional: custom clear handler
}

export function MultiSelectComboBox({
  options,
  selectedValues,
  onToggle,
  placeholder,
  allLabel,
  onClearAll,
}: MultiSelectComboBoxProps) {
  const [open, setOpen] = React.useState(false)

  const displayValue = selectedValues.includes("all") || selectedValues.length === 0
    ? allLabel
    : selectedValues.join(", ")

  const hasActiveFilter = selectedValues.length > 0 && !selectedValues.includes("all")

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onClearAll) {
      onClearAll()
    } else {
      // Default: clear all selected values
      selectedValues.forEach(value => {
        if (value !== 'all') {
          onToggle(value)
        }
      })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          title={`Filter by ${placeholder}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg justify-between text-sm font-medium h-auto px-2.5 py-1 transition-colors shadow-none",
            "text-[#4B5563] hover:text-black",
            hasActiveFilter
              ? "bg-white hover:bg-[#F3F4F6]"
              : "hover:bg-[#F3F4F6] rounded-full border-none"
          )}
        >
          <span className="flex items-center gap-1.5 flex-1">
            <FunnelSimpleIcon size={14} weight="bold" />
            {displayValue}
          </span>
          {hasActiveFilter && (
            <span
              onClick={handleClearAll}
              className="ml-2 p-1 hover:bg-gray-200 rounded cursor-pointer"
              title="Clear all filters"
            >
              <X size={14} className="text-gray-500 hover:text-gray-700" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0">
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}...`} className="h-9" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>            
              {options.map((option) => {
                const isSelected = selectedValues.includes(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => onToggle(option.value)}
                    className="cursor-pointer flex items-center"
                  >
                    {/* Checkbox */}
                    <div
                      className={cn(
                        "mr-2 h-4 w-4 rounded border flex items-center justify-center",
                        isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300"
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3 w-3 text-white",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </div>
                    
                    {/* Token Icon */}
                    {option.icon && (
                      <span className="mr-1 h-4 w-4 flex items-center justify-center">
                        {option.icon}
                      </span>
                    )}
                    
                    {/* Label */}
                    <span>{option.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
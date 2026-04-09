import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "text-white shadow-sm bg-primary hover:bg-primary/90 active:bg-primary/85",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-border bg-card shadow-sm hover:bg-secondary/60 hover:border-primary/40 active:bg-secondary/80",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:bg-secondary",
        ghost:
          "hover:bg-secondary/80 hover:text-foreground active:bg-secondary",
        link: "text-primary underline-offset-4 hover:underline",
        "danger-outline":
          "border border-destructive/30 text-destructive bg-transparent hover:bg-destructive/5",
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3 3xl:h-10 3xl:px-5 3xl:text-[15px]',
        sm: 'h-8 rounded-xl gap-1.5 px-3 has-[>svg]:px-2.5 text-[13px] 3xl:h-9 3xl:text-sm',
        lg: 'h-11 rounded-xl px-5 has-[>svg]:px-4 3xl:h-12 3xl:px-6 3xl:text-[15px]',
        icon: 'size-9 3xl:size-10',
        'icon-sm': 'size-8 3xl:size-9',
        'icon-lg': 'size-11 3xl:size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

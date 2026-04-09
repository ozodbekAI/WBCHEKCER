import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer cursor-pointer data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/25 dark:data-[state=unchecked]:bg-muted-foreground/30 focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-6 w-11 3xl:h-7 3xl:w-[52px] shrink-0 items-center rounded-full border-2 border-transparent shadow-sm transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 hover:data-[state=unchecked]:bg-muted-foreground/35',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          'bg-white pointer-events-none block size-5 3xl:size-6 rounded-full shadow-md ring-0 transition-transform data-[state=checked]:translate-x-5 3xl:data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0'
        }
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
